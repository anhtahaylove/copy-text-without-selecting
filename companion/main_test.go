package main

import "testing"

func TestIsNativeMessagingInvocation(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want bool
	}{
		{name: "explicit flag", args: []string{"companion.exe", "--native-messaging"}, want: true},
		{name: "chrome origin", args: []string{"companion.exe", "chrome-extension://abcdefghijklmnop/"}, want: true},
		{name: "desktop mode", args: []string{"companion.exe"}, want: false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := isNativeMessagingInvocation(testCase.args); got != testCase.want {
				t.Fatalf("expected %v, got %v", testCase.want, got)
			}
		})
	}
}

func TestIsStartupInvocation(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want bool
	}{
		{name: "startup flag", args: []string{"companion.exe", "--startup"}, want: true},
		{name: "desktop mode", args: []string{"companion.exe"}, want: false},
		{name: "native messaging flag only", args: []string{"companion.exe", "--native-messaging"}, want: false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := isStartupInvocation(testCase.args); got != testCase.want {
				t.Fatalf("expected %v, got %v", testCase.want, got)
			}
		})
	}
}
