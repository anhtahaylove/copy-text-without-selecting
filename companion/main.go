package main

import (
	"embed"
	"fmt"
	"log"
	"os"
	"strings"

	"copytextcompanion/internal/companion"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	service := companion.NewService(companion.DefaultPaths())

	if isNativeMessagingInvocation(os.Args) {
		if err := companion.RunNativeMessaging(os.Stdin, os.Stdout, service); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	runDesktop(service, isStartupInvocation(os.Args))
}

func isNativeMessagingInvocation(args []string) bool {
	if len(args) <= 1 {
		return false
	}
	return args[1] == "--native-messaging" || strings.HasPrefix(args[1], "chrome-extension://")
}

func isStartupInvocation(args []string) bool {
	for _, arg := range args[1:] {
		if arg == "--startup" {
			return true
		}
	}
	return false
}

func runDesktop(service *companion.Service, startMinimized bool) {
	app := NewApp(service)
	startState := options.Normal
	if startMinimized {
		startState = options.Minimised
	}
	err := wails.Run(&options.App{
		Title:            "Copy Text Companion",
		Width:            1040,
		Height:           720,
		MinWidth:         720,
		MinHeight:        500,
		WindowStartState: startState,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "6f0a9ea7-1b56-4f55-a76c-0f4c6b6fd43f",
			OnSecondInstanceLaunch: func(options.SecondInstanceData) {
				app.OpenApp()
			},
		},
		Menu: createAppMenu(app),
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

func createAppMenu(app *App) *menu.Menu {
	appMenu := menu.NewMenu()
	fileMenu := appMenu.AddSubmenu("Companion")
	fileMenu.AddText("Show", keys.Combo("space", keys.ControlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		app.OpenApp()
	})
	fileMenu.AddText("Minimize", keys.Control("h"), func(_ *menu.CallbackData) {
		app.HideApp()
	})
	fileMenu.AddSeparator()
	fileMenu.AddText("Quit", keys.Control("q"), func(_ *menu.CallbackData) {
		app.Quit()
	})
	return appMenu
}
