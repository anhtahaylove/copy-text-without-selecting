package main

import (
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	productName                  = "Copy Text Companion"
	publisherName                = "copy-text-without-selecting"
	hostName                     = "com.copy_text_without_selecting.companion"
	productionExtensionID        = "obhagoegpnbklgknnmbglghkfdidegkl"
	installDirName               = "CopyTextWithoutSelecting"
	installedCompanionFile       = "copy-text-companion.exe"
	installedSetupFile           = "CopyTextCompanionSetup.exe"
	nativeHostDescription        = "Copy Text Without Selecting native clipboard companion"
	googleNativeHostRegistryPath = `Software\Google\Chrome\NativeMessagingHosts\` + hostName
	chromiumNativeRegistryPath   = `Software\Chromium\NativeMessagingHosts\` + hostName
	uninstallRegistryPath        = `Software\Microsoft\Windows\CurrentVersion\Uninstall\CopyTextWithoutSelectingCompanion`
	runRegistryPath              = `Software\Microsoft\Windows\CurrentVersion\Run`
	autoStartValueName           = "CopyTextCompanion"
	companionPayloadPath         = "payload/copy-text-companion.exe"
)

var (
	version = "dev"
	commit  = "unknown"
)

//go:embed payload/*
var payload embed.FS

type installerOptions struct {
	Silent      bool
	Uninstall   bool
	ExtensionID string
	InstallRoot string
	NoLaunch    bool
	PurgeData   bool
	ShowHelp    bool
}

type nativeManifest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Path           string   `json:"path"`
	Type           string   `json:"type"`
	AllowedOrigins []string `json:"allowed_origins"`
}

type installPaths struct {
	Root         string
	CompanionExe string
	SetupExe     string
	ManifestDir  string
	ManifestPath string
	DataDir      string
}

type fileSnapshot struct {
	Path    string
	Existed bool
	Data    []byte
}

type registryDefaultSnapshot struct {
	Path    string
	Existed bool
	Value   string
}

func main() {
	options, err := parseOptions(os.Args[1:])
	if err == nil && options.ShowHelp {
		fmt.Fprint(os.Stdout, usage())
		return
	}
	if err == nil {
		err = run(options)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(options installerOptions) error {
	if runtime.GOOS != "windows" {
		return errors.New("Copy Text Companion installer is Windows-only")
	}
	if options.ExtensionID != "" {
		if err := validateExtensionID(options.ExtensionID); err != nil {
			return err
		}
	}

	paths, err := resolveInstallPaths(options.InstallRoot)
	if err != nil {
		return err
	}

	if options.Uninstall {
		return uninstall(options, paths)
	}
	return install(options, paths)
}

func install(options installerOptions, paths installPaths) error {
	companionExe, err := readCompanionPayload()
	if err != nil {
		return err
	}

	selfExe, err := os.Executable()
	if err != nil {
		return err
	}
	selfBytes, err := os.ReadFile(selfExe)
	if err != nil {
		return fmt.Errorf("read setup executable: %w", err)
	}

	manifest := buildNativeManifest(paths.CompanionExe, options.ExtensionID)
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("encode native manifest: %w", err)
	}

	files := snapshotFiles(paths.CompanionExe, paths.SetupExe, paths.ManifestPath)
	registryDefaults := snapshotRegistryDefaults(googleNativeHostRegistryPath, chromiumNativeRegistryPath)
	uninstallExisted, uninstallValues := snapshotUninstallRegistry()

	if err := os.MkdirAll(paths.ManifestDir, 0o755); err != nil {
		return err
	}
	if err := writeFileAtomic(paths.CompanionExe, companionExe, 0o755); err != nil {
		restoreFiles(files)
		return fmt.Errorf("install companion executable: %w", closeCompanionHint(err))
	}
	if err := writeFileAtomic(paths.SetupExe, selfBytes, 0o755); err != nil {
		restoreFiles(files)
		return fmt.Errorf("install setup executable: %w", err)
	}
	if err := writeFileAtomic(paths.ManifestPath, manifestBytes, 0o644); err != nil {
		restoreFiles(files)
		return fmt.Errorf("write native manifest: %w", err)
	}

	if err := setRegistryDefault(googleNativeHostRegistryPath, paths.ManifestPath); err != nil {
		rollbackInstall(files, registryDefaults, uninstallExisted, uninstallValues)
		return fmt.Errorf("register Chrome native host: %w", err)
	}
	if err := setRegistryDefault(chromiumNativeRegistryPath, paths.ManifestPath); err != nil {
		rollbackInstall(files, registryDefaults, uninstallExisted, uninstallValues)
		return fmt.Errorf("register Chromium native host: %w", err)
	}
	if err := writeUninstallRegistry(paths, version); err != nil {
		rollbackInstall(files, registryDefaults, uninstallExisted, uninstallValues)
		return fmt.Errorf("write uninstall registry: %w", err)
	}

	if !options.NoLaunch {
		if err := exec.Command(paths.CompanionExe).Start(); err != nil {
			return fmt.Errorf("installed but could not launch companion: %w", err)
		}
	}

	if !options.Silent {
		fmt.Printf("%s installed to %s\n", productName, paths.Root)
	}
	return nil
}

func uninstall(options installerOptions, paths installPaths) error {
	var cleanupErrors []error

	if err := deleteRegistryKey(googleNativeHostRegistryPath); err != nil {
		cleanupErrors = append(cleanupErrors, fmt.Errorf("remove Chrome native host: %w", err))
	}
	if err := deleteRegistryKey(chromiumNativeRegistryPath); err != nil {
		cleanupErrors = append(cleanupErrors, fmt.Errorf("remove Chromium native host: %w", err))
	}
	if err := deleteRegistryKey(uninstallRegistryPath); err != nil {
		cleanupErrors = append(cleanupErrors, fmt.Errorf("remove uninstall entry: %w", err))
	}
	if err := deleteRegistryValue(runRegistryPath, autoStartValueName); err != nil {
		cleanupErrors = append(cleanupErrors, fmt.Errorf("remove auto-start entry: %w", err))
	}

	removePaths := []string{
		paths.ManifestPath,
		paths.CompanionExe,
	}
	for _, target := range removePaths {
		if err := os.Remove(target); err != nil && !errors.Is(err, fs.ErrNotExist) {
			cleanupErrors = append(cleanupErrors, fmt.Errorf("remove %s: %w", target, closeCompanionHint(err)))
		}
	}

	if isCurrentExecutable(paths.SetupExe) {
		if err := scheduleSelfDelete(paths.SetupExe, paths.ManifestDir, paths.Root); err != nil {
			cleanupErrors = append(cleanupErrors, err)
		}
	} else if err := os.Remove(paths.SetupExe); err != nil && !errors.Is(err, fs.ErrNotExist) {
		cleanupErrors = append(cleanupErrors, fmt.Errorf("remove setup executable: %w", err))
	}

	removeEmptyDirs(paths.ManifestDir, paths.Root)
	if options.PurgeData {
		if err := os.RemoveAll(paths.DataDir); err != nil {
			cleanupErrors = append(cleanupErrors, fmt.Errorf("remove user data: %w", err))
		}
	}

	if len(cleanupErrors) > 0 {
		return errors.Join(cleanupErrors...)
	}
	if !options.Silent {
		fmt.Printf("%s uninstalled\n", productName)
	}
	return nil
}

func parseOptions(args []string) (installerOptions, error) {
	var options installerOptions
	normalized := make([]string, 0, len(args))
	for _, arg := range args {
		switch {
		case arg == "/S":
			normalized = append(normalized, "--silent")
		case strings.HasPrefix(arg, "/D="):
			normalized = append(normalized, "--install-root", strings.TrimPrefix(arg, "/D="))
		default:
			normalized = append(normalized, arg)
		}
	}

	flags := flag.NewFlagSet("CopyTextCompanionSetup", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	flags.BoolVar(&options.Silent, "silent", false, "run without prompts")
	flags.BoolVar(&options.Uninstall, "uninstall", false, "uninstall the companion")
	flags.StringVar(&options.ExtensionID, "extension-id", "", "additional unpacked Chrome extension ID")
	flags.StringVar(&options.InstallRoot, "install-root", "", "per-user install root")
	flags.BoolVar(&options.NoLaunch, "no-launch", false, "do not launch the companion after install")
	flags.BoolVar(&options.PurgeData, "purge-data", false, "delete user history and settings during uninstall")
	flags.BoolVar(&options.ShowHelp, "help", false, "show help")
	if err := flags.Parse(normalized); err != nil {
		return installerOptions{}, err
	}
	if flags.NArg() > 0 {
		return installerOptions{}, fmt.Errorf("unexpected argument: %s", flags.Arg(0))
	}
	return options, nil
}

func usage() string {
	return strings.TrimSpace(fmt.Sprintf(`
%s setup %s (%s)

Options:
  --silent                 Run without prompts.
  --uninstall              Remove the installed companion and native host registration.
  --extension-id <id>      Add an unpacked Chrome extension ID to allowed_origins.
  --install-root <path>    Override the per-user install root.
  --no-launch              Install without launching the companion.
  --purge-data             Delete user history/settings during uninstall.
  /S                       Alias for --silent.
  /D=<path>                Alias for --install-root <path>.
`, productName, version, commit)) + "\n"
}

func resolveInstallPaths(installRoot string) (installPaths, error) {
	root := installRoot
	if root == "" {
		localAppData := os.Getenv("LOCALAPPDATA")
		if localAppData == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return installPaths{}, err
			}
			localAppData = filepath.Join(home, "AppData", "Local")
		}
		root = filepath.Join(localAppData, installDirName)
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return installPaths{}, err
	}

	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = os.TempDir()
	}
	manifestDir := filepath.Join(root, "NativeMessagingHosts")
	return installPaths{
		Root:         root,
		CompanionExe: filepath.Join(root, installedCompanionFile),
		SetupExe:     filepath.Join(root, installedSetupFile),
		ManifestDir:  manifestDir,
		ManifestPath: filepath.Join(manifestDir, hostName+".json"),
		DataDir:      filepath.Join(appData, installDirName),
	}, nil
}

func validateExtensionID(extensionID string) error {
	if len(extensionID) != 32 {
		return errors.New("extension ID must be 32 characters")
	}
	for _, char := range extensionID {
		if char < 'a' || char > 'p' {
			return errors.New("extension ID must contain only characters a through p")
		}
	}
	return nil
}

func buildNativeManifest(companionPath string, extensionID string) nativeManifest {
	allowedOrigins := []string{
		fmt.Sprintf("chrome-extension://%s/", productionExtensionID),
	}
	if extensionID != "" {
		allowedOrigins = append(allowedOrigins, fmt.Sprintf("chrome-extension://%s/", extensionID))
	}
	return nativeManifest{
		Name:           hostName,
		Description:    nativeHostDescription,
		Path:           companionPath,
		Type:           "stdio",
		AllowedOrigins: allowedOrigins,
	}
}

func readCompanionPayload() ([]byte, error) {
	data, err := payload.ReadFile(companionPayloadPath)
	if err != nil {
		return nil, fmt.Errorf("embedded companion payload is missing; rebuild with npm run native:package-installer: %w", err)
	}
	if len(data) == 0 {
		return nil, errors.New("embedded companion payload is empty")
	}
	return data, nil
}

func writeFileAtomic(target string, data []byte, mode fs.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	tempFile, err := os.CreateTemp(filepath.Dir(target), filepath.Base(target)+".tmp-*")
	if err != nil {
		return err
	}
	tempPath := tempFile.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tempPath)
		}
	}()
	if _, err := tempFile.Write(data); err != nil {
		_ = tempFile.Close()
		return err
	}
	if err := tempFile.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tempPath, mode); err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := os.Rename(tempPath, target); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func snapshotFiles(paths ...string) []fileSnapshot {
	snapshots := make([]fileSnapshot, 0, len(paths))
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			snapshots = append(snapshots, fileSnapshot{Path: path})
			continue
		}
		snapshots = append(snapshots, fileSnapshot{Path: path, Existed: true, Data: data})
	}
	return snapshots
}

func restoreFiles(snapshots []fileSnapshot) {
	for _, snapshot := range snapshots {
		if !snapshot.Existed {
			_ = os.Remove(snapshot.Path)
			continue
		}
		_ = writeFileAtomic(snapshot.Path, snapshot.Data, 0o644)
	}
}

func snapshotRegistryDefaults(paths ...string) []registryDefaultSnapshot {
	snapshots := make([]registryDefaultSnapshot, 0, len(paths))
	for _, path := range paths {
		value, existed, _ := readRegistryDefault(path)
		snapshots = append(snapshots, registryDefaultSnapshot{Path: path, Existed: existed, Value: value})
	}
	return snapshots
}

func restoreRegistryDefaults(snapshots []registryDefaultSnapshot) {
	for _, snapshot := range snapshots {
		if !snapshot.Existed {
			_ = deleteRegistryKey(snapshot.Path)
			continue
		}
		_ = setRegistryDefault(snapshot.Path, snapshot.Value)
	}
}

func rollbackInstall(files []fileSnapshot, registryDefaults []registryDefaultSnapshot, uninstallExisted bool, uninstallValues map[string]string) {
	restoreFiles(files)
	restoreRegistryDefaults(registryDefaults)
	if uninstallExisted {
		_ = restoreUninstallRegistry(uninstallValues)
	} else {
		_ = deleteRegistryKey(uninstallRegistryPath)
	}
}

func closeCompanionHint(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%w; close Copy Text Companion and retry", err)
}

func removeEmptyDirs(paths ...string) {
	for _, path := range paths {
		_ = os.Remove(path)
	}
}

func isCurrentExecutable(path string) bool {
	current, err := os.Executable()
	if err != nil {
		return false
	}
	return samePath(current, path)
}

func samePath(left string, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr != nil || rightErr != nil {
		return false
	}
	return strings.EqualFold(filepath.Clean(leftAbs), filepath.Clean(rightAbs))
}
