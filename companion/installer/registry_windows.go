//go:build windows

package main

import (
	"errors"
	"fmt"
	"os/exec"

	"golang.org/x/sys/windows/registry"
)

func setRegistryDefault(path string, value string) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, path, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	return key.SetStringValue("", value)
}

func readRegistryDefault(path string) (string, bool, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, path, registry.QUERY_VALUE)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return "", false, nil
		}
		return "", false, err
	}
	defer key.Close()
	value, _, err := key.GetStringValue("")
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return "", false, nil
		}
		return "", false, err
	}
	return value, true, nil
}

func deleteRegistryKey(path string) error {
	err := registry.DeleteKey(registry.CURRENT_USER, path)
	if err != nil && !errors.Is(err, registry.ErrNotExist) {
		return err
	}
	return nil
}

func deleteRegistryValue(path string, name string) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, path, registry.SET_VALUE)
	if err != nil {
		if errors.Is(err, registry.ErrNotExist) {
			return nil
		}
		return err
	}
	defer key.Close()
	err = key.DeleteValue(name)
	if err != nil && !errors.Is(err, registry.ErrNotExist) {
		return err
	}
	return nil
}

func writeUninstallRegistry(paths installPaths, version string) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, uninstallRegistryPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()

	values := map[string]string{
		"DisplayName":          productName,
		"DisplayVersion":       version,
		"Publisher":            publisherName,
		"InstallLocation":      paths.Root,
		"DisplayIcon":          paths.CompanionExe,
		"UninstallString":      fmt.Sprintf(`"%s" --uninstall`, paths.SetupExe),
		"QuietUninstallString": fmt.Sprintf(`"%s" --uninstall --silent`, paths.SetupExe),
	}
	for name, value := range values {
		if err := key.SetStringValue(name, value); err != nil {
			return err
		}
	}
	if err := key.SetDWordValue("NoModify", 1); err != nil {
		return err
	}
	return key.SetDWordValue("NoRepair", 1)
}

func snapshotUninstallRegistry() (bool, map[string]string) {
	key, err := registry.OpenKey(registry.CURRENT_USER, uninstallRegistryPath, registry.QUERY_VALUE)
	if err != nil {
		return false, nil
	}
	defer key.Close()

	names := []string{
		"DisplayName",
		"DisplayVersion",
		"Publisher",
		"InstallLocation",
		"DisplayIcon",
		"UninstallString",
		"QuietUninstallString",
	}
	values := make(map[string]string)
	for _, name := range names {
		value, _, err := key.GetStringValue(name)
		if err == nil {
			values[name] = value
		}
	}
	return true, values
}

func restoreUninstallRegistry(values map[string]string) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, uninstallRegistryPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	for name, value := range values {
		if err := key.SetStringValue(name, value); err != nil {
			return err
		}
	}
	return nil
}

func scheduleSelfDelete(setupPath string, manifestDir string, installRoot string) error {
	command := fmt.Sprintf(
		`ping 127.0.0.1 -n 2 > nul & del /f /q %s & rmdir %s 2> nul & rmdir %s 2> nul`,
		quoteCmdArg(setupPath),
		quoteCmdArg(manifestDir),
		quoteCmdArg(installRoot),
	)
	return exec.Command("cmd.exe", "/C", command).Start()
}

func quoteCmdArg(value string) string {
	return `"` + value + `"`
}
