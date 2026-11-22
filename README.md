# wake

Keep this Mac awake, with a countdown that fills the terminal.

## Install

```
brew tap fredrikhaugen/tap
brew install wake
```

Needs macOS. Homebrew installs Node for you.

### From source

```
npm install
npm link
```

Needs Node 24 or newer. If you installed from source before and now switch to Homebrew, run `npm unlink -g wake` first, or Homebrew can't link the command.

## Usage

```
Usage: wake [duration]

Keep this Mac awake: no sleep, no screen saver, no auto-lock.

  wake          until you stop it
  wake 30s      for 30 seconds
  wake 3m       for 3 minutes
  wake 2h       for 2 hours
  wake 1h30m    units combine: s, m, h, d

Press q or Ctrl-C to stop. Unplugged, wake also stops when the
battery drops to 10%.
```

Durations go up to 365 days.

To run wake in the background, use `wake 2h </dev/null >/dev/null &` and stop it with `kill %1`. Without the redirects the shell suspends it, and the suspended caffeinate keeps the Mac awake past the timer.

## How it works

wake runs `caffeinate -d -i -m -s -u -w <wake's pid>`. While wake runs, caffeinate holds assertions that prevent display sleep, idle sleep and, on the power adapter, system sleep (`pmset -g assertions` lists them). Keeping the display awake is what is meant to stop the screen saver and the auto-lock that follows it. Because caffeinate watches wake's process id, it exits when wake does, however wake ends.

The timer follows the wall clock, so time the Mac spends asleep still counts.

Low battery rule: when the Mac is running on battery and charge is 10% or lower, wake stops and says so. It checks before starting and every 30 seconds, for timed and open-ended runs.

Closing the lid still puts a Mac running on battery to sleep. wake cannot prevent that.

## Uninstall

```
brew uninstall wake
```

If you installed from source:

```
npm unlink -g wake
```

## License

MIT. See [LICENSE](LICENSE).
