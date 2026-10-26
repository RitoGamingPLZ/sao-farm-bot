# SAO Farm Bot

A browser-console bot for **Snored Art Online** (`dev-sao.potato-proxy.com`).
It plays through the same connection the game page uses and sends the same commands the buttons send, so you don't install anything.

It has three modes:

| Mode | What it does |
|------|--------------|
| `level` | Accepts quests on every floor, finishes them, follows the story, grinds the best safe area and beats the next floor boss once it's weak enough. Stops at a target level. |
| `farm` | Fights a list of bosses over and over until you own enough of each drop. Hunts while the boss cooldowns run. |
| `secret` | EXP farm in the floor-40 secret area. Walks to town to reset the miasma debuff, restocks instant potions and reorders skills for the most damage. |

A **safety loop** runs in every mode (and while idle). It drinks potions, uses the emergency heal and teleports out when HP gets low.

---

## Quick start

1. Open the game in your browser and log in.
2. Open the developer console:
   - Windows / Linux: `F12` or `Ctrl + Shift + J`
   - Mac: `Cmd + Option + J`
3. Go to the **Console** tab.
4. Open [`sao-bot.js`](sao-bot.js), copy **all** of it, paste it into the console and press **Enter**.
   - Chrome may ask you to type `allow pasting` first. Type it, press Enter, then paste again.
5. Wait a few seconds. You should see something like:
   ```
   bot installed (idle, run __bot.start("level") etc.) | {"mode":"none", "lv":52, ...}
   ```
6. Start a mode:
   ```js
   __bot.start('level')    // or 'farm' or 'secret'
   ```

Keep the game tab open. Browsers slow down hidden tabs, so it works best in its own window that stays visible.

> **After a page reload the bot is gone.** Paste the script again.

---

## Console commands

| Command | What it does |
|---------|--------------|
| `__bot.start('level')` | Start levelling (quests, story, grind, floor bosses) |
| `__bot.start('farm')` | Start the boss-drop farm |
| `__bot.start('secret')` | Start the secret-area EXP farm |
| `__bot.stop()` | Stop the current mode. Your character keeps doing whatever it was doing; the safety loop stays on. |
| `__bot_status()` | One-line status: mode, level, area, HP, potions, last log lines |
| `__bot.log` | The last 300 things the bot did |
| `__bot.farmStatus()` | Progress of each farm target |
| `__bot.cfg` | The live settings (see below) |

Only one mode runs at a time. Starting a new one replaces the old one.

---

## Settings

All settings are in the `CONFIG` block at the top of `sao-bot.js`. You can either:

- **edit the file before pasting**, so your settings are used every time, or
- **change them live** from the console, e.g. `__bot.cfg.level.targetLevel = 90`. Live changes are lost when the page reloads.

### Start-up

| Setting | Default | Meaning |
|---------|---------|---------|
| `autostart` | `'none'` | Mode to start right after pasting: `'level'`, `'farm'`, `'secret'` or `'none'` |
| `blockReload` | `true` | Stop the page from reloading itself when the server pushes an update (a reload would remove the bot) |

### Healing (`heal`)

| Setting | Default | Meaning |
|---------|---------|---------|
| `mode` | `'auto'` | `'bot'`: the bot heals you using the percentages below.<br>`'crystal'`: the game's own auto-drink heals you (set it up in the game's **Settings**: pick a potion and a percent); the bot only uses a full-heal crystal in emergencies.<br>`'auto'`: `'crystal'` in secret mode, `'bot'` otherwise.<br>`'off'`: the bot never heals. |
| `teleportAt` | `0.10` | Use a teleport crystal below 10 % HP |
| `emergencyAt` | `0.20` | Use the emergency heal below 20 % HP |
| `potionAt` | `0.25` | Drink a potion below 25 % HP |
| `boss` | `{0.10, 0.20, 0.35}` | Same three values, used during boss fights |
| `crystalAt` | `0.10` | In `'crystal'` mode, use a full-heal crystal below 10 % HP (teleport crystal if you have no full-heal crystals) |
| `afterTeleportWaitMs` / `resumeAt` | `60000` / `0.95` | After a teleport, wait up to 60 s for HP to reach 95 % before going back out |
| `maxHpFallback` | `18000` | Max HP is read from the screen. This is only used if it can't be read. |

HP values are fractions: `0.25` means 25 %.

### Items (`items`)

The item ids the bot buys and uses: `potion` (`potion-2d`), `teleport` (`crystal-teleport`), `fullHeal` (`crystal-heal`), `instant` (`instant-2`). Change them if you want a different potion.

### Mode `level`

| Setting | Default | Meaning |
|---------|---------|---------|
| `targetLevel` | `80` | Stop at this level |
| `maxFloor` | `40` | Never go above this floor |
| `bossMargin` | `2` | Only fight a floor boss when it is at least this many levels below you. Raise it to play safer. |
| `bossStartHp` | `0.97` | Only start a floor boss at 97 % HP or more |
| `potionMin` / `potionBuy` | `100` / `300` | When you have fewer than 100 potions, go buy 300 |

### Mode `farm`

| Setting | Default | Meaning |
|---------|---------|---------|
| `minHp` | `0.80` | Only start a boss fight at 80 % HP or more |
| `priorityFloor` | `32` | When several bosses are ready, do this floor first |
| `targets` | 5 bosses | The bosses to farm, see below |

Each target looks like this:

```js
{ f: 32, id: 'boss-f32', name: 'Crystal ring', need: 10 }
```

- `f`: floor of the boss
- `id`: item id of the drop you want. Copies in your inventory **and** equipped gear both count.
- `need`: stop farming that boss once you own this many
- `name`: just a label for `__bot.farmStatus()`

Farming stops by itself when every target is done. You need to have cleared a floor before you can farm its boss.

### Mode `secret`

The secret area gives a **miasma** debuff: +15 % damage taken for every 20 minutes inside. The timer only resets while you stand in that floor's town, so the bot walks to town every few minutes and comes straight back.

| Setting | Default | Meaning |
|---------|---------|---------|
| `floor` / `area` / `town` | `40` / `'f40-secret'` / `'f40-town'` | Where the secret area is |
| `pathToTown` | field → outskirts → town | Areas walked, in order, from the secret area to town |
| `pathToSecret` | field → secret | Areas walked, in order, from town to the secret area |
| `nextToSecret` | `['f40-depths']` | Areas that connect straight to the secret area |
| `resetEveryMin` | `15` | Go reset the miasma after this many minutes inside |
| `restAt` | `0.70` | In town, wait until HP is at least 70 % before going back |
| `targetLevel` | `70` | Stop at this level |
| `instantMin` / `instantRestockTo` | `500` / `3000` | When you have fewer than 500 instant potions, buy up to 3000 |
| `shopFloor` | `16` | Floor whose town sells the instant potion |

### Skill cycler (`cycler`)

During normal fights it reorders your skill slots so the strongest skill that is **ready** (not on cooldown) is in slot 1. It never runs in boss fights.

| Setting | Default | Meaning |
|---------|---------|---------|
| `useIn` | `['secret']` | Modes that use it. Use `['secret', 'level']` to add levelling, or `[]` to turn it off. |
| `score` | 7 skills | Skill id → score. Higher scores are put first. |

**Put your own skills in `score`.** Only skills listed there are moved; skills you haven't learned are ignored. Your other skills keep any leftover slots.

---

## Examples

Level to 75 while playing safer against floor bosses:

```js
__bot.cfg.level.targetLevel = 75
__bot.cfg.level.bossMargin = 4
__bot.start('level')
```

Farm only the floor-35 boss until you have 5 drops:

```js
__bot.cfg.farm.targets = [{ f: 35, id: 'boss-f35', name: 'f35 helm', need: 5 }]
__bot.cfg.farm.priorityFloor = 35
__bot.start('farm')
```

Secret farm with the game's auto-drink doing the healing, and miasma resets every 10 minutes:

```js
__bot.cfg.secret.resetEveryMin = 10
__bot.start('secret')
```

Start the secret farm automatically every time you paste: in the file, set `autostart: 'secret'`.

---

## Troubleshooting

**"the game socket was not seen yet"**
Click anything in the game (a tab, a button) so the page sends something, then run `__bot.ws.close()`. The game reconnects and the bot picks up the state.

**"no state arrived yet"**
Wait a few seconds and run `__bot_status()`. If it still says `BOT MISSING`, reload the page and paste the script again.

**The bot isn't doing anything**
- `__bot_status()`: is `mode` `"none"`? Then it finished (target reached, farm done) or your character died. Check `__bot.log`.
- In `level` mode it may be resting after a teleport, or walking to a town to restock.

**It keeps walking back to town**
- Out of potions and no shop found? It waits 10 minutes before trying again.
- In `secret` mode this is the miasma reset trip. That's normal.

**Pasting a new version of the script**
You can paste it again over the old one; it stops the old timers first. A page reload first is the cleanest way.

---

## Disclaimer

Using a bot may be against the game's rules. Use it at your own risk.
