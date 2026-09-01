/**
 * FairReact Universal Web Player App
 * Ultra-Smooth Glitch-Free Sync Engine with Zero-Loop Guards and Mobile Autoplay Unlocking.
 */

(function () {
  'use strict';

  let syncEngine = new FairReactSyncEngine();
  let reactorPlayer = null;
  let originalPlayer = null;
  let isReactorReady = false;
  let isOriginalReady = false;
  let isReactorPlaying = false;
  let isOriginalPlaying = false;
  let isOriginalSeeking = false;
  let lastSeekTimestamp = 0;

  let syncWatchdogTimer = null;
  let cinemaAutoHideTimer = null;
  let pipAutoHideTimer = null;

  let isPipVisible = false;
  let isDragging = false;
  let isResizing = false;
  let isPinching = false;
  let isScrubbing = false;
  let dragOffset = { x: 0, y: 0 };
  let resizeStart = { x: 0, y: 0, w: 0, h: 0 };
  let pinchStart = { dist: 0, w: 0, h: 0 };

  let reactorVolume = 100;
  let isReactorMuted = false;
  let pipVolume = 80;
  let isPipMuted = false;
  let currentDockIndex = 0;
  let currentSizeIndex = 1;

  const sizePresets = [
    { w: 240, h: 165 },
    { w: 380, h: 255 },
    { w: 520, h: 340 }
  ];

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

  function hardClosePiP() {
    if (pipWindow) {
      pipWindow.classList.add('hidden');
      pipWindow.style.setProperty('display', 'none', 'important');
      pipWindow.style.setProperty('visibility', 'hidden', 'important');
      pipWindow.style.setProperty('opacity', '0', 'important');
      pipWindow.style.setProperty('pointer-events', 'none', 'important');
    }
    isPipVisible = false;
    if (originalPlayer && isOriginalReady) {
      try {
        if (originalPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
          originalPlayer.pauseVideo();
        }
      } catch (e) {}
    }
  }

  function hardOpenPiP() {
    if (pipWindow) {
      pipWindow.classList.remove('hidden');
      pipWindow.style.removeProperty('display');
      pipWindow.style.removeProperty('visibility');
      pipWindow.style.removeProperty('opacity');
      pipWindow.style.removeProperty('pointer-events');
    }
    isPipVisible = true;
  }

  function evaluatePiPState(currentTime) {
    if (!syncEngine || !syncEngine.isActive || !syncEngine.segments || syncEngine.segments.length === 0) {
      hardClosePiP();
      return;
    }

    const firstSeg = syncEngine.segments[0];
    const lastSeg = syncEngine.segments[syncEngine.segments.length - 1];

    const reactionStart = firstSeg.reactStart;
    const reactionEnd = (lastSeg.reactEnd !== Infinity) ? lastSeg.reactEnd : Infinity;
    const maxOrigEnd = (lastSeg.origEnd !== Infinity) ? lastSeg.origEnd : (lastSeg.origStart || Infinity);

    const target = syncEngine.calculateTarget(currentTime);
    const isOriginalContentFinished = (maxOrigEnd !== Infinity && target.targetTime >= maxOrigEnd);

    if (currentTime >= reactionEnd || target.state === 'ENDED' || isOriginalContentFinished) {
      hardClosePiP();
      return;
    }

    if (currentTime < reactionStart - 3.0) {
      hardClosePiP();
      if (originalPlayer && isOriginalReady) {
        try {
          const origTime = originalPlayer.getCurrentTime() || 0;
          if (Math.abs(origTime - firstSeg.origStart) > 2.0 && Date.now() - lastSeekTimestamp > 1500) {
            lastSeekTimestamp = Date.now();
            originalPlayer.seekTo(firstSeg.origStart, true);
          }
          if (originalPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
            originalPlayer.pauseVideo();
          }
        } catch (e) {}
      }
      return;
    }

    if (currentTime < reactionStart) {
      const timeUntilStart = reactionStart - currentTime;
      hardOpenPiP();
      const statusPill = document.getElementById('pip-status-pill');
      const statusText = document.getElementById('pip-status-text');
      if (statusPill) {
        statusPill.className = 'fr-status-pill fr-status-waiting';
        statusText.textContent = 'Starts in ' + Math.ceil(timeUntilStart) + 's';
      }
      if (originalPlayer && isOriginalReady) {
        try {
          const origTime = originalPlayer.getCurrentTime() || 0;
          if (Math.abs(origTime - firstSeg.origStart) > 2.0 && Date.now() - lastSeekTimestamp > 1500) {
            lastSeekTimestamp = Date.now();
            originalPlayer.seekTo(firstSeg.origStart, true);
          }
          if (originalPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
            originalPlayer.pauseVideo();
          }
        } catch (e) {}
      }
      return;
    }

    if (target.state === 'PLAYING') {
      hardOpenPiP();
      const statusPill = document.getElementById('pip-status-pill');
      const statusText = document.getElementById('pip-status-text');
      if (statusPill) {
        statusPill.className = 'fr-status-pill fr-status-sync';
        statusText.textContent = 'Synced (' + FairReactSyncEngine.formatSeconds(target.targetTime) + ')';
      }

      if (originalPlayer && isOriginalReady) {
        const reactorState = reactorPlayer ? reactorPlayer.getPlayerState() : -1;
        const origState = originalPlayer.getPlayerState();

        if (reactorState === YT.PlayerState.PLAYING) {
          const origTime = originalPlayer.getCurrentTime() || 0;
          const drift = Math.abs(origTime - target.targetTime);

          if (drift > 2.0 && Date.now() - lastSeekTimestamp > 1500 && !isOriginalSeeking) {
            lastSeekTimestamp = Date.now();
            isOriginalSeeking = true;
            originalPlayer.seekTo(target.targetTime, true);
            setTimeout(() => { isOriginalSeeking = false; }, 800);
          }

          if (origState === YT.PlayerState.PAUSED || origState === YT.PlayerState.CUED || origState === -1) {
            originalPlayer.playVideo();
          }
        } else if (reactorState === YT.PlayerState.PAUSED) {
          if (origState === YT.PlayerState.PLAYING || origState === YT.PlayerState.BUFFERING) {
            originalPlayer.pauseVideo();
          }
        }
      }
    } else if (target.state === 'PAUSED_ZONE') {
      hardOpenPiP();
      const statusPill = document.getElementById('pip-status-pill');
      const statusText = document.getElementById('pip-status-text');
      if (statusPill) {
        statusPill.className = 'fr-status-pill fr-status-pause';
        statusText.textContent = 'Reactor Commentary';
      }
      if (originalPlayer && isOriginalReady) {
        const origState = originalPlayer.getPlayerState();
        if (origState === YT.PlayerState.PLAYING) {
          originalPlayer.pauseVideo();
        }
        const origTime = originalPlayer.getCurrentTime() || 0;
        if (Math.abs(origTime - target.targetTime) > 2.0 && Date.now() - lastSeekTimestamp > 1500) {
          lastSeekTimestamp = Date.now();
          originalPlayer.seekTo(target.targetTime, true);
        }
      }
    } else {
      hardClosePiP();
    }
  }

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
  };

  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  const firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

  function onReactorPlayerReady() {
    isReactorReady = true;
    checkBothReady();
  }

  function onOriginalPlayerReady() {
    isOriginalReady = true;
    if (originalPlayer && typeof originalPlayer.setVolume === 'function') {
      originalPlayer.setVolume(pipVolume);
    }
    checkBothReady();
  }

  function checkBothReady() {
    if (isReactorReady && isOriginalReady) {
      if (syncWatchdogTimer) clearInterval(syncWatchdogTimer);
      syncWatchdogTimer = setInterval(syncLoop, 250);
    }
  }

  function onReactorPlayerStateChange(event) {
    const playBtn = document.getElementById('btn-cinema-play');

    if (event.data === YT.PlayerState.PLAYING) {
      isReactorPlaying = true;
      if (playBtn) playBtn.textContent = '⏸';
      startCinemaAutoHide();
      startPiPAutoHide();
      if (originalPlayer && isOriginalReady) {
        const curTime = reactorPlayer.getCurrentTime() || 0;
        evaluatePiPState(curTime);
      }
    } else if (event.data === YT.PlayerState.PAUSED) {
      isReactorPlaying = false;
      if (playBtn) playBtn.textContent = '▶';
      if (originalPlayer && isOriginalReady) {
        originalPlayer.pauseVideo();
      }
      revealCinemaControls();
      revealPiPControls();
    } else if (event.data === YT.PlayerState.ENDED) {
      isReactorPlaying = false;
      if (playBtn) playBtn.textContent = '▶';
      hardClosePiP();
      revealCinemaControls();
    } else if (event.data === YT.PlayerState.BUFFERING) {
      if (originalPlayer && isOriginalReady && originalPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
        originalPlayer.pauseVideo();
      }
    }
  }

  function onOriginalPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
      isOriginalPlaying = true;
      isOriginalSeeking = false;
    } else if (event.data === YT.PlayerState.PAUSED) {
      isOriginalPlaying = false;
    } else if (event.data === YT.PlayerState.BUFFERING) {
      isOriginalPlaying = false;
    }
  }

  function syncLoop() {
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

    evaluatePiPState(curTime);
  }

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
    try {
      const state = reactorPlayer.getPlayerState();
      if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
        reactorPlayer.pauseVideo();
        if (originalPlayer && isOriginalReady) originalPlayer.pauseVideo();
        if (btnCinemaPlay) btnCinemaPlay.textContent = '▶';
      } else {
        reactorPlayer.playVideo();
        if (btnCinemaPlay) btnCinemaPlay.textContent = '⏸';
      }
    } catch (e) {
      reactorPlayer.playVideo();
    }
    revealCinemaControls();
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
          evaluatePiPState(seekTime);
        }
      } else if (isRight) {
        if (reactorPlayer) {
          const curTime = reactorPlayer.getCurrentTime() || 0;
          const seekTime = curTime + 10;
          lastSeekTimestamp = Date.now();
          reactorPlayer.seekTo(seekTime, true);
          evaluatePiPState(seekTime);
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
    const rect = scrubberTrack.getBoundingClientRect();
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0));
    const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const pct = clickX / rect.width;
    const duration = reactorPlayer.getDuration() || 0;
    const seekTime = pct * duration;

    const progressFill = document.getElementById('main-progress-fill');
    const progressThumb = document.getElementById('main-progress-thumb');
    if (progressFill) progressFill.style.width = (pct * 100) + '%';
    if (progressThumb) progressThumb.style.left = (pct * 100) + '%';

    lastSeekTimestamp = Date.now();
    reactorPlayer.seekTo(seekTime, true);
    evaluatePiPState(seekTime);
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
        evaluatePiPState(seekTime);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (reactorPlayer) {
        const curTime = reactorPlayer.getCurrentTime() || 0;
        const seekTime = curTime + 5;
        lastSeekTimestamp = Date.now();
        reactorPlayer.seekTo(seekTime, true);
        evaluatePiPState(seekTime);
      }
    }
  });

  const pipHeader = document.getElementById('pip-header');
  const pipClickShield = document.getElementById('pip-click-shield');
  const dragOverlay = document.getElementById('drag-overlay');
  const resizeHandle = document.getElementById('pip-resize-handle');

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

    const newWidth = Math.max(180, Math.min(window.innerWidth * 0.95, pinchStart.w * scale));
    const newHeight = Math.round(newWidth * (9 / 16) + 74);

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

  if (resizeHandle) {
    const handleResizeStart = (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      isResizing = true;
      revealPiPControls();
      if (dragOverlay) dragOverlay.classList.add('active');

      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

      resizeStart.x = clientX;
      resizeStart.y = clientY;
      resizeStart.w = pipWindow.offsetWidth;
      resizeStart.h = pipWindow.offsetHeight;

      const onResizeMove = (moveEvt) => {
        if (!isResizing) return;
        const curX = moveEvt.clientX !== undefined ? moveEvt.clientX : (moveEvt.touches && moveEvt.touches[0] ? moveEvt.touches[0].clientX : resizeStart.x);
        const dw = curX - resizeStart.x;
        const newW = Math.max(180, Math.min(window.innerWidth * 0.95, resizeStart.w + dw));
        const newH = Math.round(newW * (9 / 16) + 74);
        pipWindow.style.width = newW + 'px';
        pipWindow.style.height = newH + 'px';
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

    resizeHandle.addEventListener('mousedown', handleResizeStart);
    resizeHandle.addEventListener('touchstart', handleResizeStart, { passive: false });
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
      evaluatePiPState(curTime);
      revealPiPControls();
    };
  }

  const btnTogglePiP = document.getElementById('btn-pip-toggle');
  if (btnTogglePiP) {
    btnTogglePiP.onclick = () => {
      if (isPipVisible) {
        hardClosePiP();
      } else {
        hardOpenPiP();
        const curTime = reactorPlayer ? reactorPlayer.getCurrentTime() || 0 : 0;
        evaluatePiPState(curTime);
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
