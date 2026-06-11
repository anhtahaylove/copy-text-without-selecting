//go:build windows

package main

import (
	"errors"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	modAlt      = 0x0001
	modControl  = 0x0002
	modShift    = 0x0004
	modNoRepeat = 0x4000
	wmHotkey    = 0x0312
	wmQuit      = 0x0012
	vkSpace     = 0x20
)

type nativeMessage struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Point   struct {
		X int32
		Y int32
	}
}

type hotkeyManager struct {
	mu       sync.Mutex
	callback func()
	active   *hotkeyRegistration
}

type hotkeyRegistration struct {
	stop     chan struct{}
	done     chan struct{}
	threadID uint32
}

var (
	user32Proc             = syscall.NewLazyDLL("user32.dll")
	registerHotKeyProc     = user32Proc.NewProc("RegisterHotKey")
	unregisterHotKeyProc   = user32Proc.NewProc("UnregisterHotKey")
	getMessageProc         = user32Proc.NewProc("GetMessageW")
	postThreadMessageProc  = user32Proc.NewProc("PostThreadMessageW")
	kernel32HotkeyProc     = syscall.NewLazyDLL("kernel32.dll")
	getCurrentThreadIDProc = kernel32HotkeyProc.NewProc("GetCurrentThreadId")
)

func newHotkeyManager(callback func()) *hotkeyManager {
	return &hotkeyManager{callback: callback}
}

func validateHotkey(value string) error {
	_, _, ok := parseWindowsHotkey(value)
	if !ok {
		return fmt.Errorf("unsupported hotkey: %s", strings.TrimSpace(value))
	}
	return nil
}

func (manager *hotkeyManager) Update(value string) error {
	modifiers, key, ok := parseWindowsHotkey(value)
	if !ok {
		return fmt.Errorf("unsupported hotkey: %s", strings.TrimSpace(value))
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()

	manager.stopLocked()
	registration := &hotkeyRegistration{
		stop: make(chan struct{}),
		done: make(chan struct{}),
	}
	registered := make(chan error, 1)
	go runWindowsHotkey(modifiers, key, manager.callback, registration, registered)
	if err := <-registered; err != nil {
		return err
	}
	manager.active = registration
	return nil
}

func (manager *hotkeyManager) Stop() {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	manager.stopLocked()
}

func (manager *hotkeyManager) stopLocked() {
	if manager.active == nil {
		return
	}
	registration := manager.active
	manager.active = nil
	close(registration.stop)
	if registration.threadID != 0 {
		postThreadMessageProc.Call(uintptr(registration.threadID), wmQuit, 0, 0)
	}
	select {
	case <-registration.done:
	case <-time.After(1500 * time.Millisecond):
	}
}

func parseWindowsHotkey(value string) (uintptr, uintptr, bool) {
	parts := strings.Split(value, "+")
	var modifiers uintptr = modNoRepeat
	var key uintptr
	keyCount := 0

	for _, part := range parts {
		token := strings.ToLower(strings.TrimSpace(part))
		switch token {
		case "ctrl", "control":
			modifiers |= modControl
		case "shift":
			modifiers |= modShift
		case "alt", "option":
			modifiers |= modAlt
		case "space":
			key = vkSpace
			keyCount++
		default:
			if len(token) == 1 {
				char := token[0]
				if char >= 'a' && char <= 'z' {
					key = uintptr(char - 32)
					keyCount++
				} else if char >= '0' && char <= '9' {
					key = uintptr(char)
					keyCount++
				} else {
					return 0, 0, false
				}
			} else {
				return 0, 0, false
			}
		}
	}

	return modifiers, key, key != 0 && keyCount == 1 && modifiers != modNoRepeat
}

func runWindowsHotkey(modifiers uintptr, key uintptr, callback func(), registration *hotkeyRegistration, registered chan<- error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	defer close(registration.done)

	threadID, _, _ := getCurrentThreadIDProc.Call()
	registration.threadID = uint32(threadID)

	const hotkeyID = 1
	ok, _, callErr := registerHotKeyProc.Call(0, hotkeyID, modifiers, key)
	if ok == 0 {
		if callErr == syscall.Errno(0) {
			callErr = errors.New("RegisterHotKey failed")
		}
		registered <- callErr
		return
	}
	defer unregisterHotKeyProc.Call(0, hotkeyID)
	registered <- nil

	var message nativeMessage
	for {
		select {
		case <-registration.stop:
			return
		default:
		}
		result, _, _ := getMessageProc.Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if result == 0 || int32(result) == -1 {
			return
		}
		if message.Message == wmHotkey && callback != nil {
			callback()
		}
	}
}
