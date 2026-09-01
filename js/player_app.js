/**
 * FairReact Universal Web Player App
 * High-Performance Dual-Sync Engine with Dedicated Horizontal & Vertical Adjusters and 16:9 Snap.
 */

(function () {
  'use strict';

  let syncEngine = new FairReactSyncEngine();
  let reactorPlayer = null;
  let originalPlayer = null;
  let isReactorReady = false;
  let isOriginalReady = false;
  let isOriginalSeeking = false;
  let lastSeekTimestamp = 0;
  let lastRateAdjustTimestamp = 0;

  let syncWatchdogTimer = null;
  let cinemaAutoHideTimer = null;
  let pipAutoHideTimer = null;

  let isPipVisible = false;
  let isDragging = false;
  let isResizing = false;
  let isPinching = false;
  let isScrubbing = false;
  let isChildEnded = false;
  let childEndedAtReactorTime = Infinity;

  let dragOffset = { x: 0, y: 0 };
  let resizeStart = { x: 0, y: 0, w: 0, h: 0, left: 0, top: 0, dir: 'se' };
  let pinchStart = { dist: 0, w: 0, h: 0 };

  let reactorVolume = 100;
  let isReactorMuted = false;
  let pipVolume = 80;
  let isPipMuted = false;
  let currentDockIndex = 0;
  let currentSizeIndex = 1;

  // True 16:9 Cinema Presets (Zero Black Bars)
  const sizePresets = [
    { w: 240, h: 135 },
    { w: 320, h: 180 },
    { w: 480, h: 270 }
  ];

  // 1. URL Parameters & Initialization
  function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const rawR = params.get('r') || params.get('reaction') || params.get('v') || 'uPJq0RPLr9A';
    const rawO = params.get('o') || params.get('original') || 'JqFzhcWo3EU';
    const rawT = params.get('t') || params.get('token') || 'v1.NDk6MCwyNzc6MTky';

    const reactionId = FairReactSyncEngine.extractVideoId(rawR) || rawR;
    const originalId = FairReactSyncEngine.extractVideoId(rawO) || rawO;
    const token = rawT;

    return { reactionId, originalId, token };
  }

  const { reactionId, originalId, token } = getUrlParams();

  syncEngine.originalVideoId = originalId;
  const decodedPoints = FairReactSyncEngine.decodeTimeline(token);
  if (decodedPoints && decodedPoints.length > 0) {
    syncEngine.rawPoints = decodedPoints;
    syncEngine.buildSegments(decodedPoints);
    syncEngine.isActive = true;
  }

  const pipWindow = document.getElementById('pip-window');
  const bigPlayOverlay = document.getElementById('big-play-overlay');

  function showPiP() {
    if (pipWindow && !isPipVisible) {
      pipWindow.classList.remove('hidden');
      isPipVisible = true;
    }
  }

  function hidePiP() {
    if (pipWindow && isPipVisible) {
      pipWindow.classList.add('hidden');
      isPipVisible = false;
    }
  }

  function updateStatusBadge(state, targetTime = 0, timeUntilStart = 0) {
    const statusPill = document.getElementById('pip-status-pill');
    const statusText = document.getElementById('pip-status-text');
    if (!statusPill || !statusText) return;

    if (state === 'PRE_START') {
      statusPill.className = 'fr-status-pill fr-status-waiting';
      statusText.textContent = 'Starts in ' + Math.ceil(timeUntilStart) + 's';
    } else if (state === 'PLAYING') {
      statusPill.className = 'fr-status-pill fr-status-sync';
      statusText.textContent = 'Synced (' + FairReactSyncEngine.formatSeconds(targetTime) + ')';
    } else if (state === 'PAUSED_ZONE') {
      statusPill.className = 'fr-status-pill fr-status-pause';
      statusText.textContent = 'Reactor Commentary';
    }
  }

  // 2. ULTRA-SMOOTH DUAL-LOCK LIFECYCLE CONTROLLER
  function handleSyncLifecycle(currentTime) {
    if (!syncEngine || !syncEngine.isActive || !reactorPlayer || !isReactorReady || !originalPlayer || !isOriginalReady) return;

    const target = syncEngine.calculateTarget(currentTime);
    const reactorState = reactorPlayer.getPlayerState();
    const isReactorPlaying = (reactorState === YT.PlayerState.PLAYING);

    // Rewind Detection
    if (target.state === 'PLAYING' || (target.state === 'PRE_START' && target.timeUntilStart <= 3.0) || target.state === 'PAUSED_ZONE') {
      if (isChildEnded && currentTime < childEndedAtReactorTime - 1.0) {
        isChildEnded = false;
        childEndedAtReactorTime = Infinity;
      }
    }

    if (isChildEnded && currentTime >= childEndedAtReactorTime - 1.0) {
      hidePiP();
      try { originalPlayer.pauseVideo(); } catch (e) {}
      return;
    }

    if (target.state === 'PRE_START') {
      if (target.timeUntilStart <= 3.0) {
        showPiP();
        updateStatusBadge('PRE_START', target.targetTime, target.timeUntilStart);
        const origTime = originalPlayer.getCurrentTime() || 0;
        if (Math.abs(origTime - target.targetTime) > 0.3 && Date.now() - lastSeekTimestamp > 600) {
          lastSeekTimestamp = Date.now();
          originalPlayer.seekTo(target.targetTime, true);
        }
        if (originalPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
          originalPlayer.pauseVideo();
        }
      } else {
        hidePiP();
        if (originalPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
          originalPlayer.pauseVideo();
        }
      }
    } else if (target.state === 'PLAYING') {
      showPiP();
      updateStatusBadge('PLAYING', target.targetTime);

      if (isReactorPlaying) {
        const origTime = originalPlayer.getCurrentTime() || 0;
        const drift = origTime - target.targetTime;
        const absDrift = Math.abs(drift);

        // TIER 1: Hard Drift (> 0.7s) -> Instant Snap
        if (absDrift > 0.7 && Date.now() - lastSeekTimestamp > 600 && !isOriginalSeeking) {
          lastSeekTimestamp = Date.now();
          isOriginalSeeking = true;
          originalPlayer.seekTo(target.targetTime, true);
          setTimeout(() => { isOriginalSeeking = false; }, 350);
        } 
        // TIER 2: Micro-Drift (0.15s - 0.7s) -> Adaptive Micro-Rate Catch-Up
        else if (absDrift > 0.15 && Date.now() - lastRateAdjustTimestamp > 300) {
          lastRateAdjustTimestamp = Date.now();
          if (drift < 0) {
            originalPlayer.setPlaybackRate(1.15);
          } else {
            originalPlayer.setPlaybackRate(0.85);
          }
        } else if (absDrift <= 0.12) {
          if (reactorPlayer.getPlaybackRate) {
            originalPlayer.setPlaybackRate(reactorPlayer.getPlaybackRate() || 1.0);
          }
        }

        const origState = originalPlayer.getPlayerState();
        if (origState !== YT.PlayerState.PLAYING && origState !== YT.PlayerState.BUFFERING) {
          if (!isPipMuted) {
            originalPlayer.unMute();
            originalPlayer.setVolume(pipVolume);
          }
          originalPlayer.playVideo();
        }
      } else {
        if (originalPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
          originalPlayer.pauseVideo();
        }
      }
    } else if (target.state === 'PAUSED_ZONE') {
      showPiP();
      updateStatusBadge('PAUSED_ZONE', target.targetTime);
      const origTime = originalPlayer.getCurrentTime() || 0;
      if (Math.abs(origTime - target.targetTime) > 0.4 && Date.now() - lastSeekTimestamp > 600) {
        lastSeekTimestamp = Date.now();
        originalPlayer.seekTo(target.targetTime, true);
      }
      if (originalPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        originalPlayer.pauseVideo();
      }
    } else if (target.state === 'ENDED') {
      isChildEnded = true;
      childEndedAtReactorTime = currentTime;
      hidePiP();
      if (originalPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        originalPlayer.pauseVideo();
      }
    }
  }

  // 3. YouTube Players Setup
  window.onYouTubeIframeAPIReady = function () {
    reactorPlayer = new YT.Player('main-player', {
      videoId: reactionId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        playsinline: 1,
        rel: 0,
        enablejsapi: 1,
        modestbranding: 1,
        iv_load_policy: 3
      },
      events: {
        onReady: onReactorPlayerReady,
        onStateChange: onReactorPlayerStateChange
      }
    });

    originalPlayer = new YT.Player('pip-player', {
      videoId: originalId,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        playsinline: 1,
        rel: 0,
        enablejsapi: 1,
        modestbranding: 1,
        iv_load_policy: 3
      },
      events: {
        onReady: onOriginalPlayerReady,
        onStateChange: onOriginalPlayerStateChange
      }
    });

    window.reactorPlayer = reactorPlayer;
    window.originalPlayer = originalPlayer;
  };

  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  const firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

  function onReactorPlayerReady() {
    isReactorReady = true;
    if (reactorPlayer && typeof reactorPlayer.setPlaybackQuality === 'function') {
      reactorPlayer.setPlaybackQuality('hd720');
    }
    checkBothReady();
  }

  function onOriginalPlayerReady() {
    isOriginalReady = true;
    if (originalPlayer && typeof originalPlayer.setPlaybackQuality === 'function') {
      originalPlayer.setPlaybackQuality('large');
    }
    checkBothReady();
  }

  function checkBothReady() {
    if (isReactorReady && isOriginalReady) {
      if (syncWatchdogTimer) clearInterval(syncWatchdogTimer);
      syncWatchdogTimer = setInterval(watchdogSync, 100);
    }
  }

  // 4. SMART STATE CHANGE HANDLERS
  function onReactorPlayerStateChange(event) {
    const playBtn = document.getElementById('btn-cinema-play');

    if (event.data === YT.PlayerState.PLAYING) {
      if (playBtn) playBtn.textContent = '⏸';
      if (bigPlayOverlay) bigPlayOverlay.classList.add('hidden');
      startCinemaAutoHide();
      startPiPAutoHide();

      const curTime = reactorPlayer.getCurrentTime() || 0;
      const target = syncEngine.calculateTarget(curTime);

      if (originalPlayer && isOriginalReady) {
        if (target.state === 'PLAYING') {
          if (!isPipMuted) {
            originalPlayer.unMute();
            originalPlayer.setVolume(pipVolume);
          }
          originalPlayer.playVideo();
        }
      }
      handleSyncLifecycle(curTime);
    } else if (event.data === YT.PlayerState.PAUSED) {
      if (playBtn) playBtn.textContent = '▶';
      const curTime = reactorPlayer.getCurrentTime() || 0;
      if (originalPlayer && isOriginalReady) {
        originalPlayer.pauseVideo();
        const target = syncEngine.calculateTarget(curTime);
        if (target.state === 'PLAYING' || target.state === 'PAUSED_ZONE') {
          originalPlayer.seekTo(target.targetTime, true);
        }
      }
      revealCinemaControls();
      revealPiPControls();
    } else if (event.data === YT.PlayerState.ENDED) {
      if (playBtn) playBtn.textContent = '▶';
      hidePiP();
      if (originalPlayer && isOriginalReady) originalPlayer.pauseVideo();
      revealCinemaControls();
    } else if (event.data === YT.PlayerState.BUFFERING) {
      if (originalPlayer && isOriginalReady && originalPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        originalPlayer.pauseVideo();
      }
    }
  }

  function onOriginalPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
      isOriginalSeeking = false;
      if (reactorPlayer && isReactorReady) {
        const reactorState = reactorPlayer.getPlayerState();
        if (reactorState === YT.PlayerState.PLAYING) {
          const curTime = reactorPlayer.getCurrentTime() || 0;
          const target = syncEngine.calculateTarget(curTime);
          if (target.state === 'PLAYING') {
            const origTime = originalPlayer.getCurrentTime() || 0;
            const drift = Math.abs(origTime - target.targetTime);
            if (drift > 0.35 && Date.now() - lastSeekTimestamp > 400) {
              lastSeekTimestamp = Date.now();
              originalPlayer.seekTo(target.targetTime, true);
            }
          }
        } else if (reactorState === YT.PlayerState.PAUSED) {
          originalPlayer.pauseVideo();
        }
      }
    }
  }

  function watchdogSync() {
    if (!reactorPlayer || !originalPlayer || !isReactorReady || !isOriginalReady) return;

    let curTime = 0;
    let duration = 0;
    let loadedFraction = 0;

    try {
      curTime = reactorPlayer.getCurrentTime() || 0;
      duration = reactorPlayer.getDuration() || 0;
      loadedFraction = reactorPlayer.getVideoLoadedFraction() || 0;
    } catch (e) { return; }

    if (!isScrubbing && duration > 0) {
      const pct = (curTime / duration) * 100;
      const progressFill = document.getElementById('main-progress-fill');
      const progressThumb = document.getElementById('main-progress-thumb');
      const bufferedFill = document.getElementById('main-buffered');
      const timeDisplay = document.getElementById('cinema-time-txt');

      if (progressFill) progressFill.style.width = pct + '%';
      if (progressThumb) progressThumb.style.left = pct + '%';
      if (bufferedFill) bufferedFill.style.width = (loadedFraction * 100) + '%';
      if (timeDisplay) {
        timeDisplay.textContent = FairReactSyncEngine.formatSeconds(curTime) + ' / ' + FairReactSyncEngine.formatSeconds(duration);
      }
    }

    handleSyncLifecycle(curTime);
  }

  // 5. UI Controls & Master Play/Pause Toggle
  const viewport = document.getElementById('fr-viewport');
  const scrubberTrack = document.getElementById('main-scrubber');
  const btnCinemaPlay = document.getElementById('btn-cinema-play');
  const btnCinemaMute = document.getElementById('btn-cinema-mute');
  const cinemaVolSlider = document.getElementById('cinema-vol-slider');
  const btnCinemaSpeed = document.getElementById('btn-cinema-speed');
  const menuSpeed = document.getElementById('menu-speed');
  const btnCinemaQuality = document.getElementById('btn-cinema-quality');
  const menuQuality = document.getElementById('menu-quality');
  const btnCinemaCC = document.getElementById('btn-cinema-cc');
  const btnCinemaFullscreen = document.getElementById('btn-cinema-fullscreen');

  function togglePlayPause() {
    if (!reactorPlayer || !isReactorReady) return;
    if (bigPlayOverlay) bigPlayOverlay.classList.add('hidden');

    try {
      const state = reactorPlayer.getPlayerState();
      if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
        reactorPlayer.pauseVideo();
      } else {
        reactorPlayer.playVideo();
      }
    } catch (e) {
      reactorPlayer.playVideo();
    }
    revealCinemaControls();
  }

  if (bigPlayOverlay) {
    bigPlayOverlay.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause();
    });
    bigPlayOverlay.addEventListener('touchend', (e) => {
      e.stopPropagation();
      e.preventDefault();
      togglePlayPause();
    });
  }

  if (btnCinemaPlay) {
    btnCinemaPlay.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause();
    });
    btnCinemaPlay.addEventListener('touchend', (e) => {
      e.stopPropagation();
      e.preventDefault();
      togglePlayPause();
    });
  }

  const tapShield = document.getElementById('video-tap-shield');
  let lastTapTime = 0;
  let singleTapTimeout = null;

  function handleTapShield(e) {
    const now = Date.now();
    const timeSinceLast = now - lastTapTime;
    const rect = tapShield.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0);
    const clickX = clientX - rect.left;
    const isLeft = clickX < rect.width * 0.4;
    const isRight = clickX > rect.width * 0.6;

    if (timeSinceLast < 300) {
      if (singleTapTimeout) clearTimeout(singleTapTimeout);

      if (isLeft) {
        if (reactorPlayer) {
          const curTime = reactorPlayer.getCurrentTime() || 0;
          const seekTime = Math.max(0, curTime - 10);
          lastSeekTimestamp = Date.now();
          reactorPlayer.seekTo(seekTime, true);
          handleSyncLifecycle(seekTime);
        }
      } else if (isRight) {
        if (reactorPlayer) {
          const curTime = reactorPlayer.getCurrentTime() || 0;
          const seekTime = curTime + 10;
          lastSeekTimestamp = Date.now();
          reactorPlayer.seekTo(seekTime, true);
          handleSyncLifecycle(seekTime);
        }
      } else {
        toggleFullscreen();
      }
      revealCinemaControls();
      lastTapTime = 0;
    } else {
      lastTapTime = now;
      singleTapTimeout = setTimeout(() => {
        if (viewport.classList.contains('fr-controls-inactive')) {
          revealCinemaControls();
        } else {
          togglePlayPause();
        }
      }, 280);
    }
  }

  if (tapShield) {
    tapShield.addEventListener('click', handleTapShield);
  }

  function seekToScrubberPosition(e) {
    if (!reactorPlayer || !isReactorReady) return;
    if (bigPlayOverlay) bigPlayOverlay.classList.add('hidden');

    const rect = scrubberTrack.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0));
    const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const pct = clickX / rect.width;
    const duration = reactorPlayer.getDuration() || 0;
    const seekTime = pct * duration;

    const progressFill = document.getElementById('main-progress-fill');
    const progressThumb = document.getElementById('main-progress-thumb');
    if (progressFill) progressFill.style.width = pct + '%';
    if (progressThumb) progressThumb.style.left = pct + '%';

    lastSeekTimestamp = Date.now();
    reactorPlayer.seekTo(seekTime, true);
    handleSyncLifecycle(seekTime);
  }

  if (scrubberTrack) {
    scrubberTrack.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      isScrubbing = true;
      seekToScrubberPosition(e);
      revealCinemaControls();

      const onScrubMove = (moveEvt) => {
        if (!isScrubbing) return;
        seekToScrubberPosition(moveEvt);
      };

      const onScrubStop = () => {
        isScrubbing = false;
        window.removeEventListener('mousemove', onScrubMove);
        window.removeEventListener('mouseup', onScrubStop);
        startCinemaAutoHide();
      };

      window.addEventListener('mousemove', onScrubMove);
      window.addEventListener('mouseup', onScrubStop);
    });

    scrubberTrack.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      isScrubbing = true;
      seekToScrubberPosition(e);
      revealCinemaControls();
    }, { passive: true });

    scrubberTrack.addEventListener('touchmove', (e) => {
      if (isScrubbing) seekToScrubberPosition(e);
    }, { passive: true });

    scrubberTrack.addEventListener('touchend', () => {
      isScrubbing = false;
      seekToScrubberPosition(e);
      startCinemaAutoHide();
    });
  }

  if (cinemaVolSlider) {
    cinemaVolSlider.oninput = (e) => {
      reactorVolume = parseInt(e.target.value, 10);
      isReactorMuted = reactorVolume === 0;
      if (btnCinemaMute) btnCinemaMute.textContent = isReactorMuted ? '🔇' : '🔊';
      if (reactorPlayer && typeof reactorPlayer.setVolume === 'function') {
        reactorPlayer.unMute();
        reactorPlayer.setVolume(reactorVolume);
      }
      revealCinemaControls();
    };
  }

  if (btnCinemaMute) {
    btnCinemaMute.onclick = (e) => {
      e.stopPropagation();
      isReactorMuted = !isReactorMuted;
      btnCinemaMute.textContent = isReactorMuted ? '🔇' : '🔊';
      if (reactorPlayer) {
        if (isReactorMuted) reactorPlayer.mute();
        else {
          reactorPlayer.unMute();
          reactorPlayer.setVolume(reactorVolume);
        }
      }
      revealCinemaControls();
    };
  }

  if (btnCinemaSpeed && menuSpeed) {
    btnCinemaSpeed.onclick = (e) => {
      e.stopPropagation();
      menuSpeed.classList.toggle('show');
      if (menuQuality) menuQuality.classList.remove('show');
      revealCinemaControls();
    };

    menuSpeed.querySelectorAll('.fr-menu-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const speed = parseFloat(item.dataset.speed);
        if (reactorPlayer) reactorPlayer.setPlaybackRate(speed);
        if (originalPlayer) originalPlayer.setPlaybackRate(speed);
        btnCinemaSpeed.textContent = speed + 'x';
        menuSpeed.querySelectorAll('.fr-menu-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        menuSpeed.classList.remove('show');
      };
    });
  }

  if (btnCinemaQuality && menuQuality) {
    btnCinemaQuality.onclick = (e) => {
      e.stopPropagation();
      menuQuality.classList.toggle('show');
      if (menuSpeed) menuSpeed.classList.remove('show');
      revealCinemaControls();
    };

    menuQuality.querySelectorAll('.fr-menu-item').forEach(item => {
      item.onclick = (e) => {
        e.stopPropagation();
        const q = item.dataset.quality;
        if (reactorPlayer && typeof reactorPlayer.setPlaybackQuality === 'function') {
          reactorPlayer.setPlaybackQuality(q);
        }
        menuQuality.querySelectorAll('.fr-menu-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        menuQuality.classList.remove('show');
      };
    });
  }

  if (btnCinemaCC) {
    btnCinemaCC.onclick = (e) => {
      e.stopPropagation();
      ccEnabled = !ccEnabled;
      btnCinemaCC.style.color = ccEnabled ? '#818cf8' : '#f8fafc';
      if (reactorPlayer && typeof reactorPlayer.loadModule === 'function') {
        reactorPlayer.loadModule('captions');
      }
      revealCinemaControls();
    };
  }

  document.addEventListener('click', () => {
    if (menuSpeed) menuSpeed.classList.remove('show');
    if (menuQuality) menuQuality.classList.remove('show');
  });

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  if (btnCinemaFullscreen) {
    btnCinemaFullscreen.onclick = (e) => {
      e.stopPropagation();
      toggleFullscreen();
    };
  }

  document.addEventListener('fullscreenchange', () => {
    const isFs = !!document.fullscreenElement;
    if (btnCinemaFullscreen) btnCinemaFullscreen.textContent = isFs ? '✕' : '⛶';
  });

  function revealCinemaControls() {
    if (viewport) viewport.classList.remove('fr-controls-inactive');
    startCinemaAutoHide();
  }

  function hideCinemaControls() {
    if (viewport && !isScrubbing && !isDragging && !isResizing && !isPinching) {
      if (reactorPlayer && reactorPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        viewport.classList.add('fr-controls-inactive');
      }
    }
  }

  function startCinemaAutoHide() {
    if (cinemaAutoHideTimer) clearTimeout(cinemaAutoHideTimer);
    cinemaAutoHideTimer = setTimeout(hideCinemaControls, 2500);
  }

  if (viewport) {
    viewport.addEventListener('mousemove', revealCinemaControls);
    viewport.addEventListener('mouseenter', revealCinemaControls);
    viewport.addEventListener('touchstart', revealCinemaControls, { passive: true });
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space' || e.key === 'k') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFullscreen();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      if (btnCinemaMute) btnCinemaMute.click();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (reactorPlayer) {
        const curTime = reactorPlayer.getCurrentTime() || 0;
        const seekTime = Math.max(0, curTime - 5);
        lastSeekTimestamp = Date.now();
        reactorPlayer.seekTo(seekTime, true);
        handleSyncLifecycle(seekTime);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (reactorPlayer) {
        const curTime = reactorPlayer.getCurrentTime() || 0;
        const seekTime = curTime + 5;
        lastSeekTimestamp = Date.now();
        reactorPlayer.seekTo(seekTime, true);
        handleSyncLifecycle(seekTime);
      }
    }
  });

  // =========================================================================
  // 6. DEDICATED INDIVIDUAL HORIZONTAL & VERTICAL RESIZING
  // =========================================================================
  const pipHeader = document.getElementById('pip-header');
  const pipClickShield = document.getElementById('pip-click-shield');
  const dragOverlay = document.getElementById('drag-overlay');

  const resizeHandleR = document.getElementById('pip-resize-r');   // Horizontal Width Only (Right)
  const resizeHandleL = document.getElementById('pip-resize-l');   // Horizontal Width Only (Left)
  const resizeHandleB = document.getElementById('pip-resize-b');   // Vertical Height Only (Bottom)
  const resizeHandleSE = document.getElementById('pip-resize-handle'); // Corner SE
  const resizeHandleSW = document.getElementById('pip-resize-sw');     // Corner SW

  function startDrag(e) {
    if (e.target.closest('button') || e.target.closest('input')) return;
    if (e.touches && e.touches.length === 2) {
      startPinch(e);
      return;
    }

    isDragging = true;
    revealPiPControls();
    revealCinemaControls();

    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    const rect = pipWindow.getBoundingClientRect();
    dragOffset.x = clientX - rect.left;
    dragOffset.y = clientY - rect.top;

    if (dragOverlay) dragOverlay.classList.add('active');

    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchmove', onDragMove, { passive: false });
    window.addEventListener('touchend', stopDrag);
    window.addEventListener('touchcancel', stopDrag);
  }

  function onDragMove(e) {
    if (isPinching && e.touches && e.touches.length === 2) {
      onPinchMove(e);
      return;
    }
    if (!isDragging) return;

    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

    let x = clientX - dragOffset.x;
    let y = clientY - dragOffset.y;

    const maxX = window.innerWidth - pipWindow.offsetWidth - 6;
    const maxY = window.innerHeight - pipWindow.offsetHeight - 6;

    x = Math.max(6, Math.min(x, maxX));
    y = Math.max(6, Math.min(y, maxY));

    pipWindow.style.left = x + 'px';
    pipWindow.style.top = y + 'px';
    pipWindow.style.right = 'auto';
    pipWindow.style.bottom = 'auto';

    if (e.cancelable) e.preventDefault();
  }

  function stopDrag(e) {
    if (isPinching) {
      if (!e.touches || e.touches.length < 2) isPinching = false;
    }
    isDragging = false;
    if (dragOverlay) dragOverlay.classList.remove('active');

    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', stopDrag);
    window.removeEventListener('touchmove', onDragMove);
    window.removeEventListener('touchend', stopDrag);
    window.removeEventListener('touchcancel', stopDrag);

    startPiPAutoHide();
  }

  function startPinch(e) {
    isDragging = false;
    isPinching = true;
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const rect = pipWindow.getBoundingClientRect();
    pinchStart = { dist: dist || 1, w: rect.width, h: rect.height };
    if (e.cancelable) e.preventDefault();
  }

  function onPinchMove(e) {
    if (!isPinching || !e.touches || e.touches.length !== 2) return;
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const scale = currentDist / (pinchStart.dist || 1);

    const newWidth = Math.max(140, Math.min(window.innerWidth * 0.96, pinchStart.w * scale));
    const newHeight = Math.max(80, Math.min(window.innerHeight * 0.92, pinchStart.h * scale));

    pipWindow.style.width = newWidth + 'px';
    pipWindow.style.height = newHeight + 'px';
    if (e.cancelable) e.preventDefault();
  }

  if (pipHeader) {
    pipHeader.addEventListener('mousedown', startDrag);
    pipHeader.addEventListener('touchstart', startDrag, { passive: false });
  }

  if (pipClickShield) {
    pipClickShield.addEventListener('mousedown', startDrag);
    pipClickShield.addEventListener('touchstart', startDrag, { passive: false });
  }

  // Setup Dedicated Edge and Corner Resizers
  function setupDirectionalResizer(handleEl, direction) {
    if (!handleEl) return;

    const handleResizeStart = (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      isResizing = true;
      revealPiPControls();
      if (dragOverlay) dragOverlay.classList.add('active');

      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
      const rect = pipWindow.getBoundingClientRect();

      resizeStart = {
        x: clientX,
        y: clientY,
        w: rect.width,
        h: rect.height,
        left: rect.left,
        top: rect.top,
        dir: direction
      };

      const onResizeMove = (moveEvt) => {
        if (!isResizing) return;
        const curX = moveEvt.clientX !== undefined ? moveEvt.clientX : (moveEvt.touches && moveEvt.touches[0] ? moveEvt.touches[0].clientX : resizeStart.x);
        const curY = moveEvt.clientY !== undefined ? moveEvt.clientY : (moveEvt.touches && moveEvt.touches[0] ? moveEvt.touches[0].clientY : resizeStart.y);

        const deltaX = curX - resizeStart.x;
        const deltaY = curY - resizeStart.y;

        if (resizeStart.dir === 'r') {
          // HORIZONTAL WIDTH ONLY (Right side)
          const newW = Math.max(140, Math.min(window.innerWidth * 0.96, resizeStart.w + deltaX));
          pipWindow.style.width = newW + 'px';
        } else if (resizeStart.dir === 'l') {
          // HORIZONTAL WIDTH ONLY (Left side)
          const newW = Math.max(140, Math.min(window.innerWidth * 0.96, resizeStart.w - deltaX));
          const newLeft = Math.max(6, Math.min(window.innerWidth - newW - 6, resizeStart.left + deltaX));
          pipWindow.style.width = newW + 'px';
          pipWindow.style.left = newLeft + 'px';
          pipWindow.style.right = 'auto';
        } else if (resizeStart.dir === 'b') {
          // VERTICAL HEIGHT ONLY (Bottom edge)
          const newH = Math.max(80, Math.min(window.innerHeight * 0.92, resizeStart.h + deltaY));
          pipWindow.style.height = newH + 'px';
        } else if (resizeStart.dir === 'se') {
          // CORNER SE (Both)
          const newW = Math.max(140, Math.min(window.innerWidth * 0.96, resizeStart.w + deltaX));
          const newH = Math.max(80, Math.min(window.innerHeight * 0.92, resizeStart.h + deltaY));
          pipWindow.style.width = newW + 'px';
          pipWindow.style.height = newH + 'px';
        } else if (resizeStart.dir === 'sw') {
          // CORNER SW (Both)
          const newW = Math.max(140, Math.min(window.innerWidth * 0.96, resizeStart.w - deltaX));
          const newH = Math.max(80, Math.min(window.innerHeight * 0.92, resizeStart.h + deltaY));
          const newLeft = Math.max(6, Math.min(window.innerWidth - newW - 6, resizeStart.left + deltaX));
          pipWindow.style.width = newW + 'px';
          pipWindow.style.height = newH + 'px';
          pipWindow.style.left = newLeft + 'px';
          pipWindow.style.right = 'auto';
        }

        if (moveEvt.cancelable) moveEvt.preventDefault();
      };

      const onResizeStop = () => {
        isResizing = false;
        if (dragOverlay) dragOverlay.classList.remove('active');
        window.removeEventListener('mousemove', onResizeMove);
        window.removeEventListener('mouseup', onResizeStop);
        window.removeEventListener('touchmove', onResizeMove);
        window.removeEventListener('touchend', onResizeStop);
        startPiPAutoHide();
      };

      window.addEventListener('mousemove', onResizeMove);
      window.addEventListener('mouseup', onResizeStop);
      window.addEventListener('touchmove', onResizeMove, { passive: false });
      window.addEventListener('touchend', onResizeStop);
    };

    handleEl.addEventListener('mousedown', handleResizeStart);
    handleEl.addEventListener('touchstart', handleResizeStart, { passive: false });
  }

  setupDirectionalResizer(resizeHandleR, 'r');
  setupDirectionalResizer(resizeHandleL, 'l');
  setupDirectionalResizer(resizeHandleB, 'b');
  setupDirectionalResizer(resizeHandleSE, 'se');
  setupDirectionalResizer(resizeHandleSW, 'sw');

  // Snap to 16:9 Cinema Aspect Ratio (Instantly removes all black bars!)
  const btnSnap169 = document.getElementById('btn-pip-169');
  if (btnSnap169) {
    btnSnap169.onclick = () => {
      const curW = pipWindow.offsetWidth || 240;
      const cinemaH = Math.round(curW * (9 / 16));
      pipWindow.style.height = cinemaH + 'px';
      revealPiPControls();
    };
  }

  function revealPiPControls() {
    if (pipWindow) pipWindow.classList.remove('fr-autohide-inactive');
    startPiPAutoHide();
  }

  function hidePiPControls() {
    if (pipWindow && !isDragging && !isResizing && !isPinching) {
      if (reactorPlayer && reactorPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        pipWindow.classList.add('fr-autohide-inactive');
      }
    }
  }

  function startPiPAutoHide() {
    if (pipAutoHideTimer) clearTimeout(pipAutoHideTimer);
    pipAutoHideTimer = setTimeout(hidePiPControls, 2000);
  }

  if (pipWindow) {
    pipWindow.addEventListener('mouseenter', revealPiPControls);
    pipWindow.addEventListener('mousemove', revealPiPControls);
    pipWindow.addEventListener('touchstart', revealPiPControls, { passive: true });
  }

  const btnDock = document.getElementById('btn-pip-dock');
  if (btnDock) {
    const dockPositions = [
      { top: '10px', right: '10px', bottom: 'auto', left: 'auto' },
      { top: 'auto', right: '10px', bottom: '70px', left: 'auto' },
      { top: 'auto', right: 'auto', bottom: '70px', left: '10px' },
      { top: '10px', right: 'auto', bottom: 'auto', left: '10px' }
    ];

    btnDock.onclick = () => {
      currentDockIndex = (currentDockIndex + 1) % dockPositions.length;
      const pos = dockPositions[currentDockIndex];
      pipWindow.style.top = pos.top;
      pipWindow.style.right = pos.right;
      pipWindow.style.bottom = pos.bottom;
      pipWindow.style.left = pos.left;
      revealPiPControls();
    };
  }

  const btnSize = document.getElementById('btn-pip-size');
  if (btnSize) {
    btnSize.onclick = () => {
      currentSizeIndex = (currentSizeIndex + 1) % sizePresets.length;
      const preset = sizePresets[currentSizeIndex];
      pipWindow.style.width = preset.w + 'px';
      pipWindow.style.height = preset.h + 'px';
      revealPiPControls();
    };
  }

  const btnReload = document.getElementById('btn-pip-reload');
  if (btnReload) {
    btnReload.onclick = () => {
      if (!reactorPlayer || !originalPlayer) return;
      const curTime = reactorPlayer.getCurrentTime() || 0;
      const target = syncEngine.calculateTarget(curTime);
      lastSeekTimestamp = Date.now();
      originalPlayer.seekTo(target.targetTime, true);
      handleSyncLifecycle(curTime);
      revealPiPControls();
    };
  }

  const btnTogglePiP = document.getElementById('btn-pip-toggle');
  if (btnTogglePiP) {
    btnTogglePiP.onclick = () => {
      if (isPipVisible) {
        hidePiP();
      } else {
        showPiP();
        const curTime = reactorPlayer ? reactorPlayer.getCurrentTime() || 0 : 0;
        handleSyncLifecycle(curTime);
      }
    };
  }

  document.getElementById('btn-m5').onclick = () => adjustOffset(-5);
  document.getElementById('btn-m1').onclick = () => adjustOffset(-1);
  document.getElementById('btn-p1').onclick = () => adjustOffset(1);
  document.getElementById('btn-p5').onclick = () => adjustOffset(5);
  document.getElementById('btn-reset-offset').onclick = () => {
    syncEngine.manualOffset = 0;
    updateOffsetDisplay(0);
  };

  function adjustOffset(delta) {
    const newOffset = syncEngine.adjustOffset(delta);
    updateOffsetDisplay(newOffset);
    const curTime = reactorPlayer ? reactorPlayer.getCurrentTime() || 0 : 0;
    const target = syncEngine.calculateTarget(curTime);
    lastSeekTimestamp = Date.now();
    if (originalPlayer) originalPlayer.seekTo(target.targetTime, true);
    revealPiPControls();
  }

  function updateOffsetDisplay(val) {
    const offsetEl = document.getElementById('pip-offset-txt');
    if (offsetEl) {
      const sign = val > 0 ? '+' : '';
      offsetEl.textContent = sign + val.toFixed(1) + 's';
    }
  }

  const pipVolSlider = document.getElementById('pip-vol-slider');
  const btnPipMute = document.getElementById('btn-pip-mute');

  if (pipVolSlider) {
    pipVolSlider.oninput = (e) => {
      pipVolume = parseInt(e.target.value, 10);
      isPipMuted = pipVolume === 0;
      if (btnPipMute) btnPipMute.textContent = isPipMuted ? '🔇' : '🔊';
      if (originalPlayer && typeof originalPlayer.setVolume === 'function') {
        originalPlayer.unMute();
        originalPlayer.setVolume(pipVolume);
      }
      revealPiPControls();
    };
  }

  if (btnPipMute) {
    btnPipMute.onclick = () => {
      isPipMuted = !isPipMuted;
      btnPipMute.textContent = isPipMuted ? '🔇' : '🔊';
      if (originalPlayer) {
        if (isPipMuted) originalPlayer.mute();
        else {
          originalPlayer.unMute();
          originalPlayer.setVolume(pipVolume);
        }
      }
      revealPiPControls();
    };
  }
})();
