<script>
  import { onMount } from 'svelte'
  import {
    applyRace,
    awardRacePoints,
    createLobbyState,
    prunePlayers,
    raceStartControl,
    recordPlayerUpdate,
    shouldApplyRaceStart,
    startRace,
  } from './game/multiplayer.js'
  import { connectionLabel, connectionTone } from './game/connectivity.js'
  import { normalizeEditablePlayerName, normalizePlayerName } from './game/player.js'
  import { getOrCreateSessionPassphrase } from './game/joining.js'
  import { buildRemotePlayerSprites } from './game/remotePlayers.js'
  import { createRunnerState, jump, stepRunner } from './game/runner.js'
  import { passphraseToPrivkey, privkeyToPubkey, randomPassphrase } from './nostr/identity.js'
  import {
    createScoreEvent,
    createSessionEvent,
    getBestScores,
    parseSessionEvent,
    signEvent,
  } from './nostr/events.js'
  import { DEFAULT_RELAYS, fetchBestScores, openSessionRelays, publishEvent } from './nostr/relay.js'

  const NAME_KEY = 'dinogame.name.v1'
  const BEST_KEY = 'dinogame.best.v1'
  const VIEW_WIDTH = 920
  const VIEW_HEIGHT = 360
  const GROUND = 285

  let canvas
  let ctx
  let frame = 0
  let lastFrame = 0
  let joined = false
  let playerName = 'DINO'
  let privkey = ''
  let pubkey = ''
  let localBest = 0
  let highScores = []
  let scoreStatus = 'loading'
  let relayStatus = 'offline'
  let lobby = createLobbyState()
  let runner = createRunnerState({ seed: 1 })
  let sessionRelay = null
  let presenceTimer = 0
  let pruneTimer = 0
  let latestSubmittedRace = ''
  let lastMotionPublish = 0
  let scoreEvents = []

  $: competitors = lobby.players
  $: localPlayer = competitors.find((player) => player.pubkey === pubkey)
  $: currentScore = runner.score
  $: raceControl = raceStartControl(lobby, pubkey, { joined, runnerAlive: !runner.finished })
  $: canRequestRaceStart = raceControl.canStart
  $: raceButtonLabel = raceControl.label
  $: secondsLeft = Math.max(0, Math.ceil(30 - (runner.elapsed ?? 0)))
  $: remotePlayerSprites = buildRemotePlayerSprites({
    players: competitors,
    localPubkey: pubkey,
    localScore: currentScore,
    trackWidth: VIEW_WIDTH,
  })
  $: waitingForPlayers = joined && competitors.length < 2 && lobby.phase === 'idle' && relayStatus === 'connecting'
  $: relayLabel = connectionLabel(relayStatus, joined)
  $: relayTone = connectionTone(relayStatus, joined)
  $: countdown = lobby.race && lobby.phase === 'countdown'
    ? Math.max(0, Math.ceil((lobby.race.startAt - Date.now()) / 1000))
    : 0

  onMount(() => {
    restoreIdentity()
    playerName = normalizePlayerName(readStoredValue(NAME_KEY) || playerName)
    localBest = Number(readStoredValue(BEST_KEY) || 0)
    ctx = canvas.getContext('2d')
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    window.addEventListener('keydown', handleKeydown)
    canvas.addEventListener('pointerdown', handleJump)
    refreshScores()
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resizeCanvas)
      window.removeEventListener('keydown', handleKeydown)
      canvas.removeEventListener('pointerdown', handleJump)
      closeSession()
    }
  })

  function restoreIdentity() {
    const passphrase = getOrCreateSessionPassphrase({
      sessionStorage: getStorage('sessionStorage'),
      localStorage: getStorage('localStorage'),
      createPassphrase: randomPassphrase,
    })
    privkey = passphraseToPrivkey(passphrase)
    pubkey = privkeyToPubkey(privkey)
  }

  async function refreshScores() {
    scoreStatus = 'loading'
    try {
      highScores = await fetchBestScores(DEFAULT_RELAYS, 10)
      scoreStatus = highScores.length ? 'ready' : 'empty'
    } catch {
      highScores = []
      scoreStatus = 'offline'
    }
  }

  function joinLobby() {
    playerName = normalizePlayerName(playerName)
    writeStoredValue(NAME_KEY, playerName)
    joined = true
    lobby = recordPlayerUpdate(lobby, localPresence('lobby'), Date.now())
    connectSession()
  }

  function handleNameInput(event) {
    playerName = normalizeEditablePlayerName(event.currentTarget.value)
    event.currentTarget.value = playerName
  }

  function connectSession() {
    closeSession()
    sessionRelay = openSessionRelays(DEFAULT_RELAYS, {
      onStatus: (status) => {
        relayStatus = status
      },
      onOpen: () => {
        publishPresence('lobby')
      },
      onEvent: handleSessionEvent,
    })
    presenceTimer = window.setInterval(() => {
      publishPresence(lobby.phase === 'racing' ? runner.finished ? 'finished' : 'racing' : 'lobby')
    }, 1800)
    pruneTimer = window.setInterval(() => {
      lobby = prunePlayers(lobby, Date.now())
    }, 1500)
  }

  function closeSession() {
    sessionRelay?.close()
    sessionRelay = null
    if (presenceTimer) window.clearInterval(presenceTimer)
    if (pruneTimer) window.clearInterval(pruneTimer)
  }

  function handleSessionEvent(event) {
    const update = parseSessionEvent(event)
    if (!update) return

    if (update.type === 'start' && update.race) {
      applyIncomingRace(update.race)
    }

    lobby = recordPlayerUpdate(
      lobby,
      {
        pubkey: update.pubkey,
        name: update.name,
        score: update.score,
        state: update.state,
        jumpY: update.jumpY,
      },
      (update.createdAt || Math.floor(Date.now() / 1000)) * 1000,
    )
  }

  function beginRace() {
    if (!canRequestRaceStart) return
    const result = startRace(lobby, pubkey, Date.now())
    if (!result.started) return

    applyIncomingRace(result.lobby.race)
    publishSession('start', 'countdown', result.lobby.race)
  }

  function applyIncomingRace(race) {
    if (!shouldApplyRaceStart(lobby, race, Date.now())) return
    lobby = applyRace(lobby, race, Date.now())
    runner = createRunnerState({ seed: race.seed })
    latestSubmittedRace = ''
    lastMotionPublish = 0
    lastFrame = performance.now()
    publishPresence('countdown')
  }

  function publishPresence(state = 'lobby') {
    if (!joined) return
    publishSession('presence', state)
    lobby = recordPlayerUpdate(lobby, localPresence(state), Date.now())
  }

  function publishSession(type, state, race = lobby.race) {
    const event = signEvent(
      createSessionEvent(pubkey, {
        type,
        name: playerName,
        score: runner.score,
        state,
        jumpY: runner.dino.y,
        race,
      }),
      privkey,
    )
    sessionRelay?.send(event)
  }

  function localPresence(state) {
    return {
      pubkey,
      name: playerName,
      score: runner.score,
      state,
      jumpY: runner.dino.y,
    }
  }

  function handleKeydown(event) {
    if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
      event.preventDefault()
      handleJump()
    }
  }

  function handleJump() {
    if (!joined || lobby.phase !== 'racing' || runner.finished) return
    runner = jump(runner)
  }

  function tick(now) {
    const dt = Math.min((now - lastFrame) / 1000 || 0, 0.05)
    lastFrame = now

    if (lobby.race && lobby.phase === 'countdown' && Date.now() >= lobby.race.startAt) {
      lobby = { ...lobby, phase: 'racing' }
      publishPresence('racing')
    }

    if (joined && lobby.phase === 'racing' && !runner.finished) {
      const next = stepRunner(runner, dt)
      runner = next
      if (now - lastMotionPublish >= 220) {
        lastMotionPublish = now
        publishPresence('racing')
      }
      if (next.finished) {
        publishPresence('finished')
        submitRacePoints()
      }
    }

    draw()
    frame = requestAnimationFrame(tick)
  }

  async function submitRacePoints() {
    if (!lobby.race || latestSubmittedRace === lobby.race.id) return
    latestSubmittedRace = lobby.race.id
    const award = awardRacePoints(lobby.players).find((entry) => entry.pubkey === pubkey)
    const points = award?.points ?? 100

    if (points > localBest) {
      localBest = points
      writeStoredValue(BEST_KEY, String(points))
      const event = signEvent(createScoreEvent(pubkey, { name: playerName, score: points, raceId: lobby.race.id }), privkey)
      scoreEvents = [...scoreEvents, event]
      highScores = getBestScores([...scoreEvents, event, ...highScores.map(scoreToEvent)], 10)
      try {
        await publishEvent(DEFAULT_RELAYS, event)
        refreshScores()
      } catch {
        scoreStatus = 'offline'
      }
    }
  }

  function scoreToEvent(score) {
    return createScoreEvent(score.pubkey, score, { now: score.createdAt || Math.floor(Date.now() / 1000) })
  }

  function getStorage(name) {
    try {
      return globalThis[name]
    } catch {
      return null
    }
  }

  function readStoredValue(key) {
    try {
      return getStorage('localStorage')?.getItem(key) || ''
    } catch {
      return ''
    }
  }

  function writeStoredValue(key, value) {
    try {
      getStorage('localStorage')?.setItem(key, value)
    } catch {
      // Safari private browsing can reject storage writes; gameplay continues.
    }
  }

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.floor(rect.width * ratio))
    canvas.height = Math.max(1, Math.floor(rect.height * ratio))
    ctx = canvas.getContext('2d')
    ctx.setTransform(canvas.width / VIEW_WIDTH, 0, 0, canvas.height / VIEW_HEIGHT, 0, 0)
    draw()
  }

  function draw() {
    if (!ctx) return
    ctx.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT)
    drawSky()
    drawGround()
    drawObstacles()
    drawRemotePlayers()
    drawDino()
    drawHud()
  }

  function drawSky() {
    const gradient = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT)
    gradient.addColorStop(0, '#c6e6ef')
    gradient.addColorStop(0.62, '#f7f1e6')
    gradient.addColorStop(1, '#ead8b8')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT)

    drawCloud(130, 78, 0.8)
    drawCloud(510, 50, 1)
    drawCloud(770, 96, 0.68)

    ctx.fillStyle = '#e26845'
    ctx.beginPath()
    ctx.arc(835, 72, 31, 0, Math.PI * 2)
    ctx.fill()
  }

  function drawCloud(x, y, scale) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)'
    ctx.beginPath()
    ctx.ellipse(x, y, 34 * scale, 14 * scale, 0, 0, Math.PI * 2)
    ctx.ellipse(x + 25 * scale, y - 8 * scale, 24 * scale, 18 * scale, 0, 0, Math.PI * 2)
    ctx.ellipse(x + 55 * scale, y, 30 * scale, 15 * scale, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  function drawGround() {
    ctx.fillStyle = '#416a4d'
    ctx.fillRect(0, GROUND, VIEW_WIDTH, 10)
    ctx.fillStyle = '#d95f43'
    for (let x = -20; x < VIEW_WIDTH; x += 88) {
      ctx.fillRect(x + ((runner.distance / 7) % 88), GROUND + 24, 46, 5)
    }
    ctx.fillStyle = '#0f1720'
    ctx.fillRect(0, GROUND + 10, VIEW_WIDTH, 2)
  }

  function drawObstacles() {
    for (const obstacle of runner.obstacles) {
      if (obstacle.x > VIEW_WIDTH || obstacle.x + obstacle.width < 0) continue
      const y = GROUND - obstacle.height
      if (obstacle.type.includes('cactus')) {
        ctx.fillStyle = '#2f6b4f'
        ctx.fillRect(obstacle.x, y, obstacle.width, obstacle.height)
        ctx.fillStyle = '#234d3a'
        ctx.fillRect(obstacle.x + obstacle.width * 0.58, y + 10, 8, 18)
      } else {
        ctx.fillStyle = '#7a6661'
        ctx.beginPath()
        ctx.roundRect(obstacle.x, y + 4, obstacle.width, obstacle.height - 4, 6)
        ctx.fill()
      }
    }
  }

  function drawRemotePlayers() {
    for (const sprite of remotePlayerSprites) {
      drawRemoteDino(sprite)
      drawNameTag(sprite)
    }
  }

  function drawRemoteDino(sprite) {
    ctx.save()
    ctx.globalAlpha = sprite.state === 'crashed' ? 0.5 : 0.78
    ctx.fillStyle = '#315a86'
    ctx.fillRect(sprite.x + 4, sprite.y + 12, 26, 24)
    ctx.fillRect(sprite.x + 20, sprite.y + 2, 22, 18)
    ctx.fillRect(sprite.x, sprite.y + 27, 12, 8)
    ctx.fillRect(sprite.x + 10, sprite.y + 35, 7, 10)
    ctx.fillRect(sprite.x + 28, sprite.y + 35, 7, 10)
    ctx.fillStyle = '#f8f3e7'
    ctx.fillRect(sprite.x + 36, sprite.y + 8, 4, 4)
    ctx.fillStyle = '#93d0c2'
    ctx.fillRect(sprite.x + 42, sprite.y + 13, 8, 4)
    ctx.restore()
  }

  function drawNameTag(sprite) {
    ctx.save()
    ctx.font = '800 13px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'center'
    const labelWidth = Math.max(44, ctx.measureText(sprite.name).width + 12)
    const x = Math.max(labelWidth / 2 + 6, Math.min(VIEW_WIDTH - labelWidth / 2 - 6, sprite.x + sprite.width / 2))
    const y = Math.max(20, sprite.y - 10)
    ctx.fillStyle = 'rgba(16, 32, 24, 0.76)'
    ctx.beginPath()
    ctx.roundRect(x - labelWidth / 2, y - 14, labelWidth, 19, 5)
    ctx.fill()
    ctx.fillStyle = '#f8f3e7'
    ctx.fillText(sprite.name, x, y)
    ctx.restore()
  }

  function drawDino() {
    const x = 96
    const y = GROUND - runner.dino.height + runner.dino.y
    const tilt = runner.alive ? Math.sin(runner.distance / 26) * 1.5 : -8

    ctx.save()
    ctx.translate(x + 22, y + 24)
    ctx.rotate((tilt * Math.PI) / 180)
    ctx.translate(-22, -24)

    ctx.fillStyle = runner.alive ? '#243f32' : '#7c2f2f'
    ctx.fillRect(6, 12, 30, 28)
    ctx.fillRect(24, 0, 26, 22)
    ctx.fillRect(0, 28, 12, 9)
    ctx.fillRect(12, 38, 8, 12)
    ctx.fillRect(30, 38, 8, 12)
    ctx.fillStyle = '#f8f3e7'
    ctx.fillRect(42, 7, 4, 4)
    ctx.fillStyle = '#d95f43'
    ctx.fillRect(50, 12, 10, 5)
    ctx.restore()
  }

  function drawHud() {
    ctx.fillStyle = '#102018'
    ctx.font = '700 24px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText(String(runner.score).padStart(5, '0'), VIEW_WIDTH - 112, 38)
    ctx.fillText(`${String(secondsLeft).padStart(2, '0')}s`, 22, 38)

    if (!joined) {
      drawCenteredLabel('NIKOLAI', 170, 38)
    } else if (waitingForPlayers) {
      drawCenteredLabel('WAITING', 172, 34)
    } else if (countdown > 0) {
      drawCenteredLabel(String(countdown), 166, 58)
    } else if (lobby.phase !== 'racing') {
      drawCenteredLabel('READY', 172, 42)
    } else if (runner.finished) {
      drawCenteredLabel('FINISH', 172, 42)
    }
  }

  function drawCenteredLabel(text, y, size) {
    ctx.fillStyle = 'rgba(16, 32, 24, 0.84)'
    ctx.font = `800 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.fillText(text, VIEW_WIDTH / 2, y)
    ctx.textAlign = 'left'
  }
</script>

<main class="game-shell">
  <section class="stage">
    <div class="title-row">
      <div>
        <p class="eyebrow">Multiplayer jump race</p>
        <h1>Nikolai's dino race</h1>
      </div>
      <div class="status-strip" aria-label="Relay status">
        <span
          class:online={relayTone === 'online'}
          class:local={relayTone === 'local'}
          class:pending={relayTone === 'pending'}
        ></span>
        {relayLabel}
      </div>
    </div>

    <canvas bind:this={canvas} class="runner-canvas" width={920} height={360} aria-label="Dinosaur race track"></canvas>

    <div class="controls-row">
      <label class="name-field">
        <span>Name</span>
        <input
          value={playerName}
          maxlength="7"
          inputmode="text"
          autocapitalize="characters"
          autocorrect="off"
          autocomplete="nickname"
          spellcheck="false"
          on:input={handleNameInput}
        />
      </label>

      {#if !joined}
        <button class="primary-action" on:click={joinLobby}>Join</button>
      {:else}
        <button class="primary-action" disabled={!canRequestRaceStart} on:click={beginRace}>
          {raceButtonLabel}
        </button>
      {/if}

      <div class="best-box">
        <span>Best</span>
        <strong>{localBest}</strong>
      </div>
    </div>
  </section>

  <aside class="side-panel">
    <section class="panel-block">
      <div class="panel-header">
        <h2>Lobby</h2>
        <span>{competitors.length}/8</span>
      </div>
      <ol class="player-list">
        {#each competitors.slice(0, 8) as player}
          <li class:mine={player.pubkey === pubkey}>
            <span>{player.name}</span>
            <strong>{player.score}</strong>
          </li>
        {:else}
          <li class="muted-row">
            <span>EMPTY</span>
            <strong>0</strong>
          </li>
        {/each}
      </ol>
    </section>

    <section class="panel-block">
      <div class="panel-header">
        <h2>High Scores</h2>
        <button class="small-action" on:click={refreshScores}>Refresh</button>
      </div>
      <ol class="score-list">
        {#each highScores as score}
          <li>
            <span>{score.name}</span>
            <strong>{score.score}</strong>
          </li>
        {:else}
          <li class="muted-row">
            <span>{scoreStatus === 'offline' ? 'OFFLINE' : 'NONE'}</span>
            <strong>0</strong>
          </li>
        {/each}
      </ol>
    </section>
  </aside>
</main>
