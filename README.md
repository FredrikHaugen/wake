# wake

Keep this Mac awake, with a countdown that fills the terminal.

## Install

```
npm install
npm link
```

Needs Node 24 or newer. macOS only.

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

## How it works

wake runs `caffeinate -d -i -m -s -u -w <wake's pid>`. That stops display sleep, idle sleep, disk sleep and system sleep on AC power, and declares the user active so the screen saver and auto-lock stay off. Because caffeinate watches wake's process id, it exits when wake does, however wake ends.

The timer follows the wall clock, so time the Mac spends asleep still counts.

Low battery rule: when the Mac is running on battery and charge is 10% or lower, wake stops and says so. It checks before starting and every 30 seconds, for timed and open-ended runs.

Closing the lid still puts a Mac running on battery to sleep. wake cannot prevent that.

## Uninstall

```
npm unlink -g wake
```
