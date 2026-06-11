//go:build !windows

package companion

import "os"

func withFileLock(_ string, fn func() error) error {
	return fn()
}

func replaceFileAtomic(source string, target string) error {
	return os.Rename(source, target)
}
