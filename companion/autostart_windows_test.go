//go:build windows

package main

import (
	"os"
	"os/exec"
	"regexp"
	"strings"
	"testing"
)

func TestConfigureAutoStartRegistryRoundTrip(t *testing.T) {
	if os.Getenv("COPY_TEXT_TEST_AUTOSTART_REGISTRY") != "1" {
		t.Skip("set COPY_TEXT_TEST_AUTOSTART_REGISTRY=1 to touch the HKCU Run key")
	}

	original, hadOriginal := readAutoStartRegistryValueForTest(t)
	t.Cleanup(func() {
		restoreAutoStartRegistryValueForTest(t, original, hadOriginal)
	})

	if err := configureAutoStart(true); err != nil {
		t.Fatalf("enable auto-start: %v", err)
	}
	value, ok := readAutoStartRegistryValueForTest(t)
	if !ok {
		t.Fatal("expected auto-start registry value to be created")
	}
	if !strings.Contains(value, "--startup") {
		t.Fatalf("expected auto-start command to include --startup, got %q", value)
	}

	if err := configureAutoStart(false); err != nil {
		t.Fatalf("disable auto-start: %v", err)
	}
	if value, ok := readAutoStartRegistryValueForTest(t); ok {
		t.Fatalf("expected auto-start registry value to be removed, got %q", value)
	}
}

func readAutoStartRegistryValueForTest(t *testing.T) (string, bool) {
	t.Helper()
	result := exec.Command("reg", "query", autoStartRegistryPath, "/v", autoStartValueName)
	output, err := result.CombinedOutput()
	if err != nil {
		return "", false
	}
	pattern := regexp.MustCompile(regexp.QuoteMeta(autoStartValueName) + `\s+REG_SZ\s+(.+)`)
	match := pattern.FindStringSubmatch(string(output))
	if match == nil {
		return "", false
	}
	return strings.TrimSpace(match[1]), true
}

func restoreAutoStartRegistryValueForTest(t *testing.T, value string, existed bool) {
	t.Helper()
	if !existed {
		_ = exec.Command("reg", "delete", autoStartRegistryPath, "/v", autoStartValueName, "/f").Run()
		return
	}
	result := exec.Command("reg", "add", autoStartRegistryPath, "/v", autoStartValueName, "/t", "REG_SZ", "/d", value, "/f")
	if output, err := result.CombinedOutput(); err != nil {
		t.Fatalf("restore auto-start registry value: %v: %s", err, output)
	}
}
