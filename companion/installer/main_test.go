package main

import (
	"path/filepath"
	"testing"
)

func TestValidateExtensionID(t *testing.T) {
	valid := "pahmaphhgccgealefimmgjcfmobgofpp"
	if err := validateExtensionID(valid); err != nil {
		t.Fatalf("expected %s to be valid: %v", valid, err)
	}

	for _, value := range []string{
		"short",
		"pahmaphhgccgealefimmgjcfmobgofpz",
		"PAHMAPHHGCCGEALEFIMMGJCFMOBGOFPP",
	} {
		if err := validateExtensionID(value); err == nil {
			t.Fatalf("expected %s to be invalid", value)
		}
	}
}

func TestParseOptionsAcceptsWindowsAliases(t *testing.T) {
	options, err := parseOptions([]string{
		"/S",
		"/D=C:\\Temp\\CopyText",
		"--extension-id",
		"pahmaphhgccgealefimmgjcfmobgofpp",
		"--no-launch",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !options.Silent {
		t.Fatal("expected /S to enable silent mode")
	}
	if options.InstallRoot != "C:\\Temp\\CopyText" {
		t.Fatalf("unexpected install root: %q", options.InstallRoot)
	}
	if options.ExtensionID != "pahmaphhgccgealefimmgjcfmobgofpp" {
		t.Fatalf("unexpected extension ID: %q", options.ExtensionID)
	}
	if !options.NoLaunch {
		t.Fatal("expected --no-launch to be set")
	}
}

func TestBuildNativeManifestIncludesProductionAndDeveloperOrigins(t *testing.T) {
	manifest := buildNativeManifest(`C:\Users\me\AppData\Local\CopyTextWithoutSelecting\copy-text-companion.exe`, "pahmaphhgccgealefimmgjcfmobgofpp")

	if manifest.Name != hostName {
		t.Fatalf("unexpected host name: %s", manifest.Name)
	}
	if manifest.Type != "stdio" {
		t.Fatalf("unexpected manifest type: %s", manifest.Type)
	}
	expectedOrigins := []string{
		"chrome-extension://obhagoegpnbklgknnmbglghkfdidegkl/",
		"chrome-extension://pahmaphhgccgealefimmgjcfmobgofpp/",
	}
	if len(manifest.AllowedOrigins) != len(expectedOrigins) {
		t.Fatalf("unexpected origins: %#v", manifest.AllowedOrigins)
	}
	for index, expected := range expectedOrigins {
		if manifest.AllowedOrigins[index] != expected {
			t.Fatalf("origin %d: expected %s, got %s", index, expected, manifest.AllowedOrigins[index])
		}
	}
}

func TestResolveInstallPathsUsesOverridesAndAppData(t *testing.T) {
	root := filepath.Join(t.TempDir(), "install")
	appData := filepath.Join(t.TempDir(), "appdata")
	t.Setenv("APPDATA", appData)

	paths, err := resolveInstallPaths(root)
	if err != nil {
		t.Fatal(err)
	}
	if paths.Root != root {
		t.Fatalf("expected install root %s, got %s", root, paths.Root)
	}
	if paths.CompanionExe != filepath.Join(root, installedCompanionFile) {
		t.Fatalf("unexpected companion path: %s", paths.CompanionExe)
	}
	if paths.ManifestPath != filepath.Join(root, "NativeMessagingHosts", hostName+".json") {
		t.Fatalf("unexpected manifest path: %s", paths.ManifestPath)
	}
	if paths.DataDir != filepath.Join(appData, installDirName) {
		t.Fatalf("unexpected data dir: %s", paths.DataDir)
	}
}
