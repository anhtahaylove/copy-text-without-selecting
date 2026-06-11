//go:build windows

package main

import (
	_ "embed"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

//go:embed assets/appicon.png
var trayIconPNG []byte

const (
	trayUID             = 1
	trayCallbackMessage = 0x8000 + 0x531
	trayShutdownMessage = 0x8000 + 0x532

	nimAdd        = 0x00000000
	nimDelete     = 0x00000002
	nimSetVersion = 0x00000004

	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004

	notifyIconVersion4 = 4

	wmNull          = 0x0000
	wmDestroy       = 0x0002
	wmContextMenu   = 0x007b
	wmCommand       = 0x0111
	wmLButtonUp     = 0x0202
	wmLButtonDblClk = 0x0203
	wmRButtonDown   = 0x0204
	wmRButtonUp     = 0x0205
	ninSelect       = 0x0400
	ninKeySelect    = 0x0401

	csDblClks = 0x0008

	mfString    = 0x00000000
	mfSeparator = 0x00000800

	tpmRightButton = 0x0002
	tpmReturnCmd   = 0x0100

	lrDefaultSize = 0x00000040

	idiApplication = 32512
	idTrayShow     = 1001
	idTrayMinimize = 1002
	idTrayQuit     = 1003

	errorClassAlreadyExists syscall.Errno = 1410
)

type trayActions struct {
	Show     func() bool
	Minimize func() bool
	Quit     func() bool
}

type trayManager struct {
	actions trayActions

	mu   sync.Mutex
	hwnd uintptr
	done chan struct{}
}

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         [16]byte
	HBalloonIcon     uintptr
}

type trayWndClassEx struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     uintptr
	HIcon         uintptr
	HCursor       uintptr
	HbrBackground uintptr
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       uintptr
}

type trayPoint struct {
	X int32
	Y int32
}

type trayMessage struct {
	HWnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Point   trayPoint
}

var (
	trayUser32          = syscall.NewLazyDLL("user32.dll")
	trayShell32         = syscall.NewLazyDLL("shell32.dll")
	trayKernel32        = syscall.NewLazyDLL("kernel32.dll")
	procRegisterClassEx = trayUser32.NewProc("RegisterClassExW")
	procCreateWindowEx  = trayUser32.NewProc("CreateWindowExW")
	procDestroyWindow   = trayUser32.NewProc("DestroyWindow")
	procDefWindowProc   = trayUser32.NewProc("DefWindowProcW")
	procGetMessage      = trayUser32.NewProc("GetMessageW")
	procTranslateMsg    = trayUser32.NewProc("TranslateMessage")
	procDispatchMsg     = trayUser32.NewProc("DispatchMessageW")
	procPostMessage     = trayUser32.NewProc("PostMessageW")
	procPostQuitMessage = trayUser32.NewProc("PostQuitMessage")
	procLoadIcon        = trayUser32.NewProc("LoadIconW")
	procDestroyIcon     = trayUser32.NewProc("DestroyIcon")
	procCreateIcon      = trayUser32.NewProc("CreateIconFromResourceEx")
	procCreatePopupMenu = trayUser32.NewProc("CreatePopupMenu")
	procAppendMenu      = trayUser32.NewProc("AppendMenuW")
	procDestroyMenu     = trayUser32.NewProc("DestroyMenu")
	procTrackPopupMenu  = trayUser32.NewProc("TrackPopupMenu")
	procGetCursorPos    = trayUser32.NewProc("GetCursorPos")
	procSetForeground   = trayUser32.NewProc("SetForegroundWindow")
	procShellNotifyIcon = trayShell32.NewProc("Shell_NotifyIconW")
	procGetModuleHandle = trayKernel32.NewProc("GetModuleHandleW")
	trayWindowProc      = syscall.NewCallback(trayWndProc)
	trayManagers        sync.Map
)

func newTrayManager(actions trayActions) *trayManager {
	return &trayManager{actions: actions}
}

func (manager *trayManager) Start() error {
	manager.mu.Lock()
	if manager.done != nil {
		manager.mu.Unlock()
		return nil
	}
	ready := make(chan error, 1)
	manager.done = make(chan struct{})
	manager.mu.Unlock()

	go manager.run(ready)
	if err := <-ready; err != nil {
		manager.mu.Lock()
		manager.done = nil
		manager.mu.Unlock()
		return err
	}
	return nil
}

func (manager *trayManager) Stop() {
	manager.mu.Lock()
	hwnd := manager.hwnd
	done := manager.done
	manager.mu.Unlock()
	if done == nil {
		return
	}
	if hwnd != 0 {
		postTrayMessage(hwnd, trayShutdownMessage, 0, 0)
	}
	select {
	case <-done:
	case <-time.After(1500 * time.Millisecond):
	}
	manager.mu.Lock()
	manager.hwnd = 0
	manager.done = nil
	manager.mu.Unlock()
}

func (manager *trayManager) run(ready chan<- error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	defer close(manager.done)

	instance := getTrayModuleHandle()
	className := fmt.Sprintf("CopyTextCompanionTrayWindow-%d", syscall.Getpid())
	if err := registerTrayWindowClass(className, instance); err != nil {
		ready <- err
		return
	}
	hwnd, err := createTrayWindow(className, instance)
	if err != nil {
		ready <- err
		return
	}
	manager.mu.Lock()
	manager.hwnd = hwnd
	manager.mu.Unlock()
	trayManagers.Store(hwnd, manager)
	defer trayManagers.Delete(hwnd)

	icon, destroyIcon := createTrayIcon()
	if destroyIcon {
		defer procDestroyIcon.Call(icon)
	}
	data := newNotifyIconData(hwnd, icon)
	if !shellNotifyIcon(nimAdd, &data) {
		_ = destroyTrayWindow(hwnd)
		ready <- lastTrayError("Shell_NotifyIconW add failed")
		return
	}
	data.UVersion = notifyIconVersion4
	_ = shellNotifyIcon(nimSetVersion, &data)
	ready <- nil
	defer shellNotifyIcon(nimDelete, &data)

	var message trayMessage
	for {
		result, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if result == 0 || int32(result) == -1 {
			return
		}
		procTranslateMsg.Call(uintptr(unsafe.Pointer(&message)))
		procDispatchMsg.Call(uintptr(unsafe.Pointer(&message)))
	}
}

func trayWndProc(hwnd uintptr, message uint32, wParam uintptr, lParam uintptr) uintptr {
	value, ok := trayManagers.Load(hwnd)
	if !ok {
		return defTrayWindowProc(hwnd, message, wParam, lParam)
	}
	return value.(*trayManager).handleWindowMessage(hwnd, message, wParam, lParam)
}

func (manager *trayManager) handleWindowMessage(hwnd uintptr, message uint32, wParam uintptr, lParam uintptr) uintptr {
	switch message {
	case trayCallbackMessage:
		switch uint32(lParam & 0xffff) {
		case wmLButtonUp, wmLButtonDblClk, ninSelect, ninKeySelect:
			manager.trigger(manager.actions.Show)
			return 0
		case wmRButtonDown, wmRButtonUp, wmContextMenu:
			manager.showContextMenu(hwnd)
			return 0
		}
	case wmCommand:
		switch uint16(wParam & 0xffff) {
		case idTrayShow:
			manager.trigger(manager.actions.Show)
			return 0
		case idTrayMinimize:
			manager.trigger(manager.actions.Minimize)
			return 0
		case idTrayQuit:
			manager.trigger(manager.actions.Quit)
			return 0
		}
	case trayShutdownMessage:
		_ = destroyTrayWindow(hwnd)
		return 0
	case wmDestroy:
		procPostQuitMessage.Call(0)
		return 0
	}
	return defTrayWindowProc(hwnd, message, wParam, lParam)
}

func (manager *trayManager) showContextMenu(hwnd uintptr) {
	menu, _, _ := procCreatePopupMenu.Call()
	if menu == 0 {
		return
	}
	defer procDestroyMenu.Call(menu)
	appendTrayMenu(menu, mfString, idTrayShow, "Show")
	appendTrayMenu(menu, mfString, idTrayMinimize, "Minimize")
	appendTrayMenu(menu, mfSeparator, 0, "")
	appendTrayMenu(menu, mfString, idTrayQuit, "Quit")

	var point trayPoint
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&point)))
	procSetForeground.Call(hwnd)
	command, _, _ := procTrackPopupMenu.Call(
		menu,
		tpmRightButton|tpmReturnCmd,
		uintptr(point.X),
		uintptr(point.Y),
		0,
		hwnd,
		0,
	)
	if command != 0 {
		manager.handleWindowMessage(hwnd, wmCommand, command, 0)
	}
	postTrayMessage(hwnd, wmNull, 0, 0)
}

func (manager *trayManager) trigger(action func() bool) {
	if action == nil {
		return
	}
	go action()
}

func registerTrayWindowClass(className string, instance uintptr) error {
	classNamePtr, err := syscall.UTF16PtrFromString(className)
	if err != nil {
		return err
	}
	wndClass := trayWndClassEx{
		CbSize:        uint32(unsafe.Sizeof(trayWndClassEx{})),
		Style:         csDblClks,
		LpfnWndProc:   trayWindowProc,
		HInstance:     instance,
		LpszClassName: classNamePtr,
	}
	result, _, callErr := procRegisterClassEx.Call(uintptr(unsafe.Pointer(&wndClass)))
	if result == 0 && !errors.Is(callErr, errorClassAlreadyExists) {
		return lastTrayError("RegisterClassExW failed")
	}
	return nil
}

func createTrayWindow(className string, instance uintptr) (uintptr, error) {
	classNamePtr, err := syscall.UTF16PtrFromString(className)
	if err != nil {
		return 0, err
	}
	hwnd, _, _ := procCreateWindowEx.Call(
		0,
		uintptr(unsafe.Pointer(classNamePtr)),
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		instance,
		0,
	)
	if hwnd == 0 {
		return 0, lastTrayError("CreateWindowExW failed")
	}
	return hwnd, nil
}

func destroyTrayWindow(hwnd uintptr) bool {
	result, _, _ := procDestroyWindow.Call(hwnd)
	return result != 0
}

func createTrayIcon() (uintptr, bool) {
	if len(trayIconPNG) > 0 {
		icon, _, _ := procCreateIcon.Call(
			uintptr(unsafe.Pointer(&trayIconPNG[0])),
			uintptr(len(trayIconPNG)),
			1,
			0x00030000,
			0,
			0,
			lrDefaultSize,
		)
		if icon != 0 {
			return icon, true
		}
	}
	icon, _, _ := procLoadIcon.Call(0, idiApplication)
	return icon, false
}

func newNotifyIconData(hwnd uintptr, icon uintptr) notifyIconData {
	data := notifyIconData{
		CbSize:           uint32(unsafe.Sizeof(notifyIconData{})),
		HWnd:             hwnd,
		UID:              trayUID,
		UFlags:           nifMessage | nifIcon | nifTip,
		UCallbackMessage: trayCallbackMessage,
		HIcon:            icon,
	}
	copy(data.SzTip[:], syscall.StringToUTF16("Copy Text Companion"))
	return data
}

func shellNotifyIcon(command uintptr, data *notifyIconData) bool {
	result, _, _ := procShellNotifyIcon.Call(command, uintptr(unsafe.Pointer(data)))
	return result != 0
}

func appendTrayMenu(menu uintptr, flags uintptr, id uintptr, text string) {
	if flags == mfSeparator {
		procAppendMenu.Call(menu, flags, 0, 0)
		return
	}
	procAppendMenu.Call(menu, flags, id, uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(text))))
}

func postTrayMessage(hwnd uintptr, message uint32, wParam uintptr, lParam uintptr) {
	procPostMessage.Call(hwnd, uintptr(message), wParam, lParam)
}

func defTrayWindowProc(hwnd uintptr, message uint32, wParam uintptr, lParam uintptr) uintptr {
	result, _, _ := procDefWindowProc.Call(hwnd, uintptr(message), wParam, lParam)
	return result
}

func getTrayModuleHandle() uintptr {
	result, _, _ := procGetModuleHandle.Call(0)
	return result
}

func lastTrayError(prefix string) error {
	err := syscall.GetLastError()
	if err == syscall.Errno(0) {
		return errors.New(prefix)
	}
	return fmt.Errorf("%s: %w", prefix, err)
}
