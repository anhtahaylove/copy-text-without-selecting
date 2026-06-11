//go:build !windows

package main

func configureAutoStart(bool) error {
	return nil
}
