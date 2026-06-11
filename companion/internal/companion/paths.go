package companion

import (
	"os"
	"path/filepath"
)

type Paths struct {
	DataDir   string
	StorePath string
}

func DefaultPaths() Paths {
	root := os.Getenv("APPDATA")
	if root == "" {
		root = os.TempDir()
	}

	dataDir := filepath.Join(root, "CopyTextWithoutSelecting")
	return Paths{
		DataDir:   dataDir,
		StorePath: filepath.Join(dataDir, "history.json"),
	}
}
