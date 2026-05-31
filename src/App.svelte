<script>
  import { onMount } from 'svelte'
  import {
    applyRace,
    awardRacePoints,
    canFinalizeRace,
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
  import { ROUND_DURATION_SECONDS, createRunnerState, jump, stepRunner } from './game/runner.js'
  import {
    REALTIME_SEND_INTERVAL_MS,
    createRealtimeMesh,
    createRealtimeUpdate,
  } from './game/webrtc.js'
  import { passphraseToPrivkey, privkeyToPubkey, randomPassphrase } from './nostr/identity.js'
  import {
    createScoreEvent,
    createSignalEvent,
    createSessionEvent,
    getTotalScores,
    parseSignalEvent,
    parseSessionEvent,
    signEvent,
  } from './nostr/events.js'
  import { DEFAULT_RELAYS, fetchTotalScores, openSessionRelays, publishEvent } from './nostr/relay.js'

  const NAME_KEY = 'dinogame.name.v1'
  const TOTAL_KEY = 'dinogame.total.v1'
  const VIEW_WIDTH = 920
  const VIEW_HEIGHT = 360
  const GROUND = 285

  let canvas
  let ctx
  let frame = 0
  let lastFrame = 0
  let joined = false
  let playerName = ''
  let privkey = ''
  let pubkey = ''
  let localTotal = 0
  let totalScores = []
  let scoreStatus = 'loading'
  let relayStatus = 'offline'
  let lobby = createLobbyState()
  let runner = createRunnerState({ seed: 1 })
  let sessionRelay = null
  let realtime = null
  let presenceTimer = 0
  let pruneTimer = 0
  let latestSubmittedRace = ''
  let lastMotionPublish = 0
  let lastRealtimePublish = 0
  let localFinishedAt = 0
  let scoreEvents = []
  let realtimeSeq = 0
  let realtimePeers = 0

  $: competitors = lobby.players
  $: localPlayer = competitors.find((player) => player.pubkey === pubkey)
  $: currentScore = runner.score
  $: raceControl = raceStartControl(lobby, pubkey, { joined, runnerAlive: !runner.finished })
  $: canRequestRaceStart = raceControl.canStart
  $: raceButtonLabel = raceControl.label
  $: secondsLeft = Math.max(0, Math.ceil(ROUND_DURATION_SECONDS - (runner.elapsed ?? 0)))
  $: remotePlayerSprites = buildRemotePlayerSprites({
    players: competitors,
    localPubkey: pubkey,
    localScore: currentScore,
    trackWidth: VIEW_WIDTH,
  })
  $: waitingForPlayers = joined && competitors.length < 2 && lobby.phase === 'idle' && relayStatus === 'connecting'
  $: relayLabel = connectionLabel(relayStatus, joined)
  $: relayTone = connectionTone(relayStatus, joined)
  $: liveLabel = realtimePeers > 0 ? `P2P ${realtimePeers}` : relayLabel
  $: countdown = lobby.race && lobby.phase === 'countdown'
    ? Math.max(0, Math.ceil((lobby.race.startAt - Date.now()) / 1000))
    : 0

  onMount(() => {
    restoreIdentity()
    playerName = restorePlayerName()
    localTotal = readStoredNumber(TOTAL_KEY)
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
      totalScores = await fetchTotalScores(DEFAULT_RELAYS, 10)
      scoreStatus = totalScores.length ? 'ready' : 'empty'
    } catch {
      totalScores = []
      scoreStatus = 'offline'
    }
  }

  function joinLobby() {
    const editableName = normalizeEditablePlayerName(playerName)
    playerName = normalizePlayerName(editableName)
    if (editableName) writeStoredValue(NAME_KEY, editableName)
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
    openRealtime()
    presenceTimer = window.setInterval(() => {
      publishPresence(lobby.phase === 'racing' ? runner.finished ? 'finished' : 'racing' : 'lobby')
    }, 1800)
    pruneTimer = window.setInterval(() => {
      lobby = prunePlayers(lobby, Date.now())
      realtime?.updatePlayers(lobby.players)
    }, 1500)
  }

  function closeSession() {
    sessionRelay?.close()
    sessionRelay = null
    realtime?.close()
    realtime = null
    realtimePeers = 0
    if (presenceTimer) window.clearInterval(presenceTimer)
    if (pruneTimer) window.clearInterval(pruneTimer)
  }

  function handleSessionEvent(event) {
    const signal = parseSignalEvent(event)
    if (signal) {
      realtime?.handleSignal(signal)
      return
    }

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
    realtime?.updatePlayers(lobby.players)
  }

  function openRealtime() {
    realtime?.close()
    realtime = createRealtimeMesh({
      localPubkey: pubkey,
      publishSignal,
      onMessage: handleRealtimeMessage,
      onPeerStatus: (status) => {
        realtimePeers = status.connected
      },
    })
    realtime.updatePlayers(lobby.players)
  }

  function publishSignal(payload) {
    if (!joined) return
    const event = signEvent(createSignalEvent(pubkey, payload), privkey)
    sessionRelay?.send(event)
  }

  function handleRealtimeMessage(update) {
    if (!update?.pubkey || update.pubkey === pubkey) return
    if (update.raceId && lobby.race?.id && update.raceId !== lobby.race.id) return
    lobby = recordPlayerUpdate(lobby, update, Date.now())
    realtime?.updatePlayers(lobby.players)
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
    lastRealtimePublish = 0
    localFinishedAt = 0
    realtimeSeq = 0
    lastFrame = performance.now()
    publishPresence('countdown')
  }

  function publishPresence(state = 'lobby') {
    if (!joined) return
    publishSession('presence', state)
    publishRealtime(state)
    lobby = recordPlayerUpdate(lobby, localPresence(state), Date.now())
    realtime?.updatePlayers(lobby.players)
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

  function publishRealtime(state = 'lobby') {
    if (!joined || !realtime) return 0
    realtimeSeq += 1
    return realtime.broadcast(createRealtimeUpdate({
      name: playerName,
      score: runner.score,
      state,
      jumpY: runner.dino.y,
      raceId: lobby.race?.id ?? '',
      elapsed: runner.elapsed,
      seq: realtimeSeq,
    }))
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
    lastRealtimePublish = performance.now()
    publishPresence('racing')
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
      if (now - lastRealtimePublish >= REALTIME_SEND_INTERVAL_MS) {
        lastRealtimePublish = now
        publishRealtime('racing')
      }
      if (now - lastMotionPublish >= 300) {
        lastMotionPublish = now
        publishPresence('racing')
      }
      if (next.finished) {
        localFinishedAt = Date.now()
        publishPresence('finished')
      }
    }

    if (joined && lobby.phase === 'racing' && runner.finished) {
      maybeSubmitRacePoints()
    }

    draw()
    frame = requestAnimationFrame(tick)
  }

  function maybeSubmitRacePoints() {
    if (!canFinalizeRace(lobby, pubkey, localFinishedAt, Date.now())) return
    submitRacePoints()
  }

  async function submitRacePoints() {
    if (!lobby.race || latestSubmittedRace === lobby.race.id) return
    latestSubmittedRace = lobby.race.id
    const award = awardRacePoints(lobby.players).find((entry) => entry.pubkey === pubkey)
    const points = award?.points ?? 100

    localTotal += points
    writeStoredValue(TOTAL_KEY, String(localTotal))

    const event = signEvent(createScoreEvent(pubkey, { name: playerName, score: localTotal, raceId: lobby.race.id }), privkey)
    scoreEvents = [...scoreEvents, event]
    totalScores = getTotalScores([...scoreEvents, ...totalScores.map(scoreToEvent)], 10)
    try {
      await publishEvent(DEFAULT_RELAYS, event)
      refreshScores()
    } catch {
      scoreStatus = 'offline'
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

  function readStoredNumber(key) {
    const value = Number(readStoredValue(key))
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  }

  function restorePlayerName() {
    const storedName = normalizeEditablePlayerName(readStoredValue(NAME_KEY))
    return storedName === 'DINO' ? '' : storedName
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
      switch (obstacle.type) {
        case 'tortoise':
          drawTortoise(obstacle)
          break
        case 'mushroom':
          drawMushroom(obstacle)
          break
        case 'puddle':
          drawPuddle(obstacle)
          break
        default:
          drawCactus(obstacle)
      }
    }
  }

  function drawCactus(obstacle) {
    const x = obstacle.x
    const y = GROUND - obstacle.height
    const variant = obstacle.variant ?? 0
    const greens = ['#2f8a55', '#3a9b5f', '#26744d', '#4aa35f']

    ctx.fillStyle = greens[variant % greens.length]
    ctx.beginPath()
    ctx.roundRect(x + 9, y, 13, obstacle.height, 6)
    ctx.roundRect(x, y + 18, 11, 19, 5)
    ctx.roundRect(x + 20, y + 12, 10, 23, 5)
    ctx.fill()
    ctx.fillStyle = '#f8d77c'
    ctx.fillRect(x + 14, y + 8, 2, 5)
    ctx.fillRect(x + 6, y + 24, 2, 4)
    ctx.fillRect(x + 24, y + 18, 2, 4)
  }

  function drawTortoise(obstacle) {
    const x = obstacle.x
    const y = GROUND - obstacle.height
    const shellColors = ['#2f8a55', '#2f6b9a', '#7aa342', '#a35b35']
    const shell = shellColors[(obstacle.variant ?? 0) % shellColors.length]

    ctx.fillStyle = '#c98c35'
    ctx.beginPath()
    ctx.ellipse(x + 45, y + 17, 9, 7, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = shell
    ctx.beginPath()
    ctx.ellipse(x + 24, y + 14, 23, 14, 0, Math.PI, Math.PI * 2)
    ctx.lineTo(x + 47, y + 22)
    ctx.lineTo(x + 1, y + 22)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#f8d77c'
    ctx.fillRect(x + 13, y + 13, 4, 9)
    ctx.fillRect(x + 29, y + 13, 4, 9)
    ctx.fillStyle = '#102018'
    ctx.fillRect(x + 48, y + 13, 3, 3)
  }

  function drawMushroom(obstacle) {
    const x = obstacle.x
    const y = GROUND - obstacle.height
    const capColors = ['#d95f43', '#d8436f', '#e0b43c', '#c14d38']
    const cap = capColors[(obstacle.variant ?? 0) % capColors.length]

    ctx.fillStyle = '#f6d6a5'
    ctx.beginPath()
    ctx.roundRect(x + 13, y + 17, 12, 21, 5)
    ctx.fill()
    ctx.fillStyle = cap
    ctx.beginPath()
    ctx.ellipse(x + 19, y + 17, 20, 15, 0, Math.PI, Math.PI * 2)
    ctx.lineTo(x + 38, y + 18)
    ctx.lineTo(x, y + 18)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#fffaf0'
    ctx.beginPath()
    ctx.ellipse(x + 10, y + 12, 4, 3, 0, 0, Math.PI * 2)
    ctx.ellipse(x + 22, y + 8, 5, 4, 0, 0, Math.PI * 2)
    ctx.ellipse(x + 31, y + 14, 4, 3, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  function drawPuddle(obstacle) {
    const x = obstacle.x
    const y = GROUND - obstacle.height
    const blues = ['#2f8fc6', '#35a9b8', '#4b83d1', '#2f6b9a']
    ctx.fillStyle = blues[(obstacle.variant ?? 0) % blues.length]
    ctx.beginPath()
    ctx.ellipse(x + obstacle.width / 2, y + obstacle.height / 2 + 2, obstacle.width / 2, obstacle.height / 2, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255, 250, 240, 0.72)'
    ctx.beginPath()
    ctx.ellipse(x + obstacle.width * 0.36, y + 5, 13, 3, -0.16, 0, Math.PI * 2)
    ctx.fill()
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
      return
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
      <div class="status-strip" aria-label="Connection status">
        <span
          class:online={relayTone === 'online'}
          class:local={relayTone === 'local'}
          class:pending={relayTone === 'pending'}
        ></span>
        {liveLabel}
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

      <div class="total-box">
        <span>Total</span>
        <strong>{localTotal}</strong>
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
        <h2>Total Scores</h2>
        <button class="small-action" on:click={refreshScores}>Refresh</button>
      </div>
      <ol class="score-list">
        {#each totalScores as score}
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
