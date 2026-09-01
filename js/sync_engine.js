/**
 * FairReact Sync Engine
 * Decodes timeline calibration tokens, parses YouTube metadata, and computes accurate frame targets with automatic PiP intro reveal and outro auto-close.
 */

class FairReactSyncEngine {
  constructor() {
    this.originalVideoId = null;
    this.originalUrl = null;
    this.rawPoints = [];
    this.segments = [];
    this.manualOffset = 0.0;
    this.isActive = false;
  }

  /**
   * Compact Base64 Timeline Token Decoder
   * Token format: "v1.<base64_of_csv>"
   * CSV format: "reactTime:origTime,reactTime:p,..."
   */
  static decodeTimeline(token) {
    if (!token || typeof token !== 'string') return [];
    const cleanToken = token.trim();
    if (!cleanToken.startsWith('v1.')) return [];

    try {
      const b64 = cleanToken.slice(3);
      const normalizedB64 = b64.replace(/-/g, '+').replace(/_/g, '/');
      const csv = atob(normalizedB64);
      const parts = csv.split(',');
      const points = [];

      for (const part of parts) {
        if (!part) continue;
        const [rStr, oStr] = part.split(':');
        const reactTime = parseInt(rStr, 10);
        if (isNaN(reactTime)) continue;

        if (oStr === 'p' || oStr === 'P') {
          points.push({ reactTime, origTime: null, isPause: true });
        } else {
          const origTime = parseInt(oStr, 10);
          if (!isNaN(origTime)) {
            points.push({ reactTime, origTime, isPause: false });
          }
        }
      }
      return points;
    } catch (e) {
      return [];
    }
  }

  /**
   * Compact Base64 Timeline Token Encoder
   */
  static encodeTimeline(points) {
    if (!points || points.length === 0) return '';
    const cleanPoints = FairReactSyncEngine.cleanRecordedTimeline(points);
    if (!cleanPoints || cleanPoints.length === 0) return '';

    const csvParts = cleanPoints.map(p => {
      const r = Math.round(p.reactTime);
      if (p.isPause) {
        return `${r}:p`;
      } else {
        const o = Math.round(p.origTime || 0);
        return `${r}:${o}`;
      }
    });

    const csv = csvParts.join(',');
    const b64 = btoa(csv);
    return `v1.${b64}`;
  }

  static cleanRecordedTimeline(points) {
    if (!points || points.length === 0) return [];

    const firstPt = points[0];
    const initialReactTime = firstPt.reactTime || 0;
    const initialOrigTime = firstPt.origTime || 0;
    const filtered = [{ reactTime: initialReactTime, origTime: initialOrigTime, isPause: false }];

    for (let i = 1; i < points.length; i++) {
      const pt = points[i];
      if (pt.reactTime <= initialReactTime + 3 && pt.origTime <= initialOrigTime + 1) {
        continue;
      }
      if (pt.isPause && i < points.length - 1) {
        const next = points[i + 1];
        if (!next.isPause && (next.reactTime - pt.reactTime < 1.5)) {
          i++;
          continue;
        }
      }
      filtered.push(pt);
    }

    if (filtered.length >= 2) {
      const lastPt = filtered[filtered.length - 1];
      const secondLast = filtered[filtered.length - 2];
      if (secondLast.isPause && (lastPt.reactTime - secondLast.reactTime <= 3.0)) {
        filtered.splice(filtered.length - 2, 1);
      }
    }

    const finalPoints = [];
    for (let i = 0; i < filtered.length; i++) {
      const pt = filtered[i];
      const prev = finalPoints[finalPoints.length - 1];

      if (!prev) {
        finalPoints.push(pt);
        continue;
      }

      if (i === filtered.length - 1 && finalPoints.length === 1 && !pt.isPause && !prev.isPause) {
        const reactDelta = pt.reactTime - prev.reactTime;
        const origDelta = pt.origTime - prev.origTime;
        if (Math.abs(reactDelta - origDelta) <= 2.0) {
          continue;
        }
      }

      const reactDelta = pt.reactTime - prev.reactTime;
      const origDelta = pt.origTime - prev.origTime;

      if (!pt.isPause && !prev.isPause && Math.abs(reactDelta - origDelta) <= 1.5 && i < filtered.length - 1) {
        continue;
      }

      finalPoints.push(pt);
    }

    return finalPoints;
  }

  static parseTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const str = String(timeStr).trim();
    if (/^\d+$/.test(str)) return parseInt(str, 10);

    const parts = str.split(':').map(p => parseInt(p, 10));
    if (parts.some(isNaN)) return 0;

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return parts[0] || 0;
  }

  static extractVideoId(url) {
    if (!url) return null;
    const str = String(url).trim();
    const beMatch = str.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
    if (beMatch) return beMatch[1];

    const watchMatch = str.match(/[?&]v=([a-zA-Z0-9_-]{11})/i);
    if (watchMatch) return watchMatch[1];

    const oMatch = str.match(/[?&]o=([a-zA-Z0-9_-]{11})/i);
    if (oMatch) return oMatch[1];

    const pathMatch = str.match(/(?:embed|v|shorts|live)\/([a-zA-Z0-9_-]{11})/i);
    if (pathMatch) return pathMatch[1];

    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;

    return null;
  }

  static formatSeconds(seconds) {
    if (isNaN(seconds) || seconds === null || seconds < 0) return '00:00';
    const totalSecs = Math.floor(seconds);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  /**
   * Parses YouTube video description / text for sync markers, links, and encoded tokens.
   */
  parseMetadata(text, currentVideoId = null) {
    this.segments = [];
    this.rawPoints = [];
    this.originalVideoId = null;
    this.originalUrl = null;

    if (!text || typeof text !== 'string') {
      return false;
    }

    // 1. Check for token format [FairReact:v1....] or &t=v1....
    const tokenMatch = text.match(/\[(?:FairReact|fairreact):\s*(v1\.[a-zA-Z0-9_\+\/=-]+)\]/i) ||
                       text.match(/[?&]t=(v1\.[a-zA-Z0-9_\+\/=-]+)/i);

    // 2. Look for Original Video ID
    const priorityMatch = text.match(/(?:original\s*video|original|source|reacting\s*to)\s*[:=-]?\s*(https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?[^\s\)\"\[]+|youtu\.be\/[a-zA-Z0-9_-]{11}[^\s\)\"\[]*))/i) ||
                          text.match(/(https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?[^\s\)\"\[]+|youtu\.be\/[a-zA-Z0-9_-]{11}[^\s\)\"\[]*))\s*\[FairReact/i) ||
                          text.match(/\[FairReact:[^\]]+\]\s*(https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?[^\s\)\"\[]+|youtu\.be\/[a-zA-Z0-9_-]{11}[^\s\)\"\[]*))/i) ||
                          text.match(/[?&]o=([a-zA-Z0-9_-]{11})/i);

    if (priorityMatch) {
      const vid = FairReactSyncEngine.extractVideoId(priorityMatch[1]) || priorityMatch[1];
      if (vid && vid !== currentVideoId) {
        this.originalVideoId = vid;
        this.originalUrl = `https://www.youtube.com/watch?v=${vid}`;
      }
    }

    // Scan all YouTube URLs in the description if not found yet
    if (!this.originalVideoId) {
      const urlRegex = /(https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s\)\"\[]+|shorts\/[a-zA-Z0-9_-]{11})|youtu\.be\/[a-zA-Z0-9_-]{11}[^\s\)\"\[]*))/gi;
      let urlMatch;
      while ((urlMatch = urlRegex.exec(text)) !== null) {
        const url = urlMatch[1];
        const vid = FairReactSyncEngine.extractVideoId(url);
        if (vid && vid !== currentVideoId) {
          this.originalVideoId = vid;
          this.originalUrl = url;
          break;
        }
      }
    }

    if (!this.originalVideoId) {
      return false;
    }

    // If token is found, decode it
    if (tokenMatch) {
      const token = tokenMatch[1];
      const points = FairReactSyncEngine.decodeTimeline(token);
      if (points && points.length > 0) {
        this.rawPoints = points;
        this.buildSegments(points);
        this.isActive = true;
        return true;
      }
    }

    // 3. Fallback: Parse human-readable timestamps in description (e.g. "01:25 = 00:00")
    const lines = text.split(/\r?\n/);
    const parsedPoints = [];
    const dualTimeRegex = /(?:react(?:ion)?\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:=|->|:|to|-)\s*(?:orig(?:inal)?\s*)?(\d{1,2}:\d{2}(?::\d{2})?)/i;
    const pauseRegex = /(?:react(?:ion)?\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:=|->|:|to|-)\s*(?:pause|talk|stop|break|end)/i;
    const startOffsetRegex = /(?:starts?\s*(?:at|from)?|sync(?:ed)?\s*(?:at)?|offset)\s*[:=]?\s*(\d{1,2}:\d{2}(?::\d{2})?)/i;

    for (const line of lines) {
      const dualMatch = line.match(dualTimeRegex);
      if (dualMatch) {
        const rSec = FairReactSyncEngine.parseTimeToSeconds(dualMatch[1]);
        const oSec = FairReactSyncEngine.parseTimeToSeconds(dualMatch[2]);
        parsedPoints.push({ reactTime: rSec, origTime: oSec, isPause: false });
        continue;
      }

      const pauseMatch = line.match(pauseRegex);
      if (pauseMatch) {
        const rSec = FairReactSyncEngine.parseTimeToSeconds(pauseMatch[1]);
        parsedPoints.push({ reactTime: rSec, origTime: null, isPause: true });
        continue;
      }

      const startMatch = line.match(startOffsetRegex);
      if (startMatch && parsedPoints.length === 0) {
        const rSec = FairReactSyncEngine.parseTimeToSeconds(startMatch[1]);
        let initialOrig = 0;
        if (this.originalUrl) {
          const tMatch = this.originalUrl.match(/[?&]t=([\d+hms]+)/);
          if (tMatch) initialOrig = FairReactSyncEngine.parseTimeToSeconds(tMatch[1]);
        }
        parsedPoints.push({ reactTime: rSec, origTime: initialOrig, isPause: false });
      }
    }

    parsedPoints.sort((a, b) => a.reactTime - b.reactTime);

    if (parsedPoints.length > 0) {
      this.rawPoints = parsedPoints;
      this.buildSegments(parsedPoints);
    } else {
      this.segments = [{
        reactStart: 0,
        origStart: 0,
        reactEnd: Infinity,
        origEnd: Infinity,
        isPause: false
      }];
    }

    this.isActive = true;
    return true;
  }

  buildSegments(points) {
    this.segments = [];
    if (!points || points.length === 0) return;

    if (points.length === 1) {
      const pt = points[0];
      this.segments.push({
        reactStart: pt.reactTime,
        origStart: pt.origTime || 0,
        reactEnd: Infinity,
        origEnd: Infinity,
        isPause: false
      });
      return;
    }

    let lastOrigTime = points[0].origTime || 0;
    for (let i = 0; i < points.length - 1; i++) {
      const pt = points[i];
      const nextPt = points[i + 1];

      if (pt.isPause) {
        const pauseOrig = pt.origTime !== null ? pt.origTime : lastOrigTime;
        this.segments.push({
          reactStart: pt.reactTime,
          origStart: pauseOrig,
          reactEnd: nextPt.reactTime,
          origEnd: pauseOrig,
          isPause: true
        });
        lastOrigTime = pauseOrig;
      } else {
        const oStart = pt.origTime !== null ? pt.origTime : lastOrigTime;
        const duration = nextPt.reactTime - pt.reactTime;
        const oEnd = nextPt.isPause ? oStart + duration : (nextPt.origTime !== null ? nextPt.origTime : oStart + duration);

        this.segments.push({
          reactStart: pt.reactTime,
          origStart: oStart,
          reactEnd: nextPt.reactTime,
          origEnd: oEnd,
          isPause: false
        });
        lastOrigTime = oEnd;
      }
    }
  }

  getDecodedTimelineSummary() {
    if (!this.segments || this.segments.length === 0) return [];
    const summary = [];

    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      const reactStartStr = FairReactSyncEngine.formatSeconds(seg.reactStart);
      const origStartStr = FairReactSyncEngine.formatSeconds(seg.origStart);

      if (seg.isPause) {
        const duration = seg.reactEnd !== Infinity ? (seg.reactEnd - seg.reactStart) : null;
        summary.push({
          type: 'PAUSE',
          badge: '⏸ PAUSE',
          reactTime: reactStartStr,
          origTime: origStartStr,
          description: duration ? `Paused to talk for ${Math.round(duration)}s` : 'Paused to talk'
        });
      } else if (i === 0) {
        summary.push({
          type: 'START',
          badge: '🟢 START',
          reactTime: reactStartStr,
          origTime: origStartStr,
          description: 'Reaction starts & Original video plays'
        });
      } else {
        const prevSeg = this.segments[i - 1];
        let actionDesc = 'Resumes playback';
        if (seg.origStart < prevSeg.origStart) {
          actionDesc = `Rewound to ${origStartStr} & continues`;
        } else if (seg.origStart > prevSeg.origEnd + 2) {
          actionDesc = `Forwarded to ${origStartStr} & continues`;
        }

        summary.push({
          type: 'PLAY',
          badge: '▶ PLAY',
          reactTime: reactStartStr,
          origTime: origStartStr,
          description: actionDesc
        });
      }
    }

    const lastSeg = this.segments[this.segments.length - 1];
    if (lastSeg && lastSeg.reactEnd !== Infinity && lastSeg.origEnd !== Infinity && lastSeg.reactEnd > lastSeg.reactStart) {
      summary.push({
        type: 'END',
        badge: '⏹ END',
        reactTime: FairReactSyncEngine.formatSeconds(lastSeg.reactEnd),
        origTime: FairReactSyncEngine.formatSeconds(lastSeg.origEnd),
        description: 'Reaction finishes (PiP auto-closes)'
      });
    }

    return summary;
  }

  calculateTarget(reactorCurrentTime) {
    if (!this.isActive || this.segments.length === 0) {
      return { state: 'IDLE', targetTime: 0, isMutedZone: false };
    }

    const firstSegment = this.segments[0];
    if (reactorCurrentTime < firstSegment.reactStart) {
      return {
        state: 'PRE_START',
        targetTime: Math.max(0, firstSegment.origStart + this.manualOffset),
        timeUntilStart: firstSegment.reactStart - reactorCurrentTime,
        isMutedZone: true
      };
    }

    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (reactorCurrentTime >= seg.reactStart && reactorCurrentTime < seg.reactEnd) {
        if (seg.isPause) {
          return {
            state: 'PAUSED_ZONE',
            targetTime: Math.max(0, seg.origStart + this.manualOffset),
            isMutedZone: true
          };
        }

        const elapsedInSegment = reactorCurrentTime - seg.reactStart;
        const calculatedTarget = seg.origStart + elapsedInSegment + this.manualOffset;

        return {
          state: 'PLAYING',
          targetTime: Math.max(0, calculatedTarget),
          isMutedZone: false
        };
      }
    }

    const lastSeg = this.segments[this.segments.length - 1];
    return {
      state: 'ENDED',
      targetTime: lastSeg ? (lastSeg.origEnd !== Infinity ? lastSeg.origEnd : lastSeg.origStart) : 0,
      isMutedZone: true
    };
  }

  adjustOffset(deltaSeconds) {
    this.manualOffset = Math.round((this.manualOffset + deltaSeconds) * 10) / 10;
    return this.manualOffset;
  }
}

if (typeof window !== 'undefined') {
  window.FairReactSyncEngine = FairReactSyncEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FairReactSyncEngine;
}
