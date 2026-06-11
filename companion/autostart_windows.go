//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const autoStartValueName = "CopyTextCompanion"
const autoStartRegistryPath = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

func configureAutoStart(enabled bool) error {
	if enabled {
		executable, err := os.Executable()
		if err != nil {
			return err
		}
		command := fmt.Sprintf(`"%s" --startup`, executable)
		result := exec.Command("reg", "add", autoStartRegistryPath, "/v", autoStartValueName, "/t", "REG_SZ", "/d", command, "/f")
		if output, err := result.CombinedOutput(); err != nil {
			return fmt.Errorf("enable auto-start: %s", string(output))
		}
		return nil
	}

	result := exec.Command("reg", "delete", autoStartRegistryPath, "/v", autoStartValueName, "/f")
	if output, err := result.CombinedOutput(); err != nil {
		text := string(output)
		if text == "" {
			text = err.Error()
		}
		if !isMissingAutoStartValue(text) {
			return fmt.Errorf("disable auto-start: %s", text)
		}
	}
	return nil
}

func isMissingAutoStartValue(output string) bool {
	normalized := strings.ToLower(output)
	return strings.Contains(normalized, "unable to find") || strings.Contains(normalized, "cannot find")
}
