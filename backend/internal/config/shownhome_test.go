package config

import "testing"

func TestShownHomeHidesAccountName(t *testing.T) {
	cases := []struct{ path, home, want string }{
		{"/home/ubuntu/.hermes", "/home/ubuntu", "~/.hermes"},
		{"/home/ubuntu/.hermes/", "/home/ubuntu/", "~/.hermes"},
		{"/home/ubuntu", "/home/ubuntu", "~"},
		{"/home/ubuntu2/.hermes", "/home/ubuntu", "/home/ubuntu2/.hermes"},
		{"/hermes", "/root", "/hermes"},
		{"/hermes", "", "/hermes"},
		{"/hermes", "/", "/hermes"},
	}
	for _, c := range cases {
		if got := shownHome(c.path, c.home); got != c.want {
			t.Errorf("shownHome(%q, %q) = %q, want %q", c.path, c.home, got, c.want)
		}
	}
}
