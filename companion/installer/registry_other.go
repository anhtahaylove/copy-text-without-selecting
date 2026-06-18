//go:build !windows

package main

import "errors"

var errWindowsRegistryOnly = errors.New("Windows registry is unavailable on this platform")

func setRegistryDefault(path string, value string) error {
	return errWindowsRegistryOnly
}

func readRegistryDefault(path string) (string, bool, error) {
	return "", false, errWindowsRegistryOnly
}

func deleteRegistryKey(path string) error {
	return errWindowsRegistryOnly
}

func deleteRegistryValue(path string, name string) error {
	return errWindowsRegistryOnly
}

func writeUninstallRegistry(paths installPaths, version string) error {
	return errWindowsRegistryOnly
}

func snapshotUninstallRegistry() (bool, map[string]string) {
	return false, nil
}

func restoreUninstallRegistry(values map[string]string) error {
	return errWindowsRegistryOnly
}

func scheduleSelfDelete(setupPath string, manifestDir string, installRoot string) error {
	return errWindowsRegistryOnly
}
