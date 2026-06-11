//go:build windows

package companion

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

const (
	lockfileExclusiveLock   = 0x00000002
	movefileReplaceExisting = 0x00000001
	movefileWriteThrough    = 0x00000008
)

var (
	kernel32Proc     = syscall.NewLazyDLL("kernel32.dll")
	lockFileExProc   = kernel32Proc.NewProc("LockFileEx")
	unlockFileExProc = kernel32Proc.NewProc("UnlockFileEx")
	moveFileExProc   = kernel32Proc.NewProc("MoveFileExW")
)

func withFileLock(lockPath string, fn func() error) error {
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()

	var overlapped syscall.Overlapped
	locked, _, callErr := lockFileExProc.Call(
		file.Fd(),
		lockfileExclusiveLock,
		0,
		1,
		0,
		uintptr(unsafe.Pointer(&overlapped)),
	)
	if locked == 0 {
		return fmt.Errorf("lock store file: %w", callErr)
	}
	defer unlockFileExProc.Call(
		file.Fd(),
		0,
		1,
		0,
		uintptr(unsafe.Pointer(&overlapped)),
	)

	return fn()
}

func replaceFileAtomic(source string, target string) error {
	sourcePtr, err := syscall.UTF16PtrFromString(source)
	if err != nil {
		return err
	}
	targetPtr, err := syscall.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	replaced, _, callErr := moveFileExProc.Call(
		uintptr(unsafe.Pointer(sourcePtr)),
		uintptr(unsafe.Pointer(targetPtr)),
		movefileReplaceExisting|movefileWriteThrough,
	)
	if replaced == 0 {
		return fmt.Errorf("replace store file: %w", callErr)
	}
	return nil
}
