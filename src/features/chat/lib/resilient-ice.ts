// ─── Resilient ICE Configuration ─────────────────────────────────────────────
//
// Replaces the two-provider DEFAULT_ICE_CONFIG with a defence-in-depth set:
//   • 15 STUN servers across 6+ jurisdictions and 4+ network operators
//   • TURN on UDP 3478, TCP 443, and TURNS/TLS 443 per server
//
// Why TURN on TCP 443 matters:
//   Deep-packet-inspection middleboxes (including national firewalls) routinely
//   block UDP and non-standard TCP ports. Port 443 with TLS is almost never
//   blocked because it would also break HTTPS. WebRTC TURN over TCP 443
//   (and TURNS/TLS 443) makes media relay traffic indistinguishable from
//   normal HTTPS to any stateful DPI engine.
//
// Why diverse STUN providers matter:
//   Google and Cloudflare STUN servers can be — and are — blocked together by
//   regional firewalls. Peers behind such firewalls cannot discover their
//   public IP, so ICE gathering stalls. Using 15 servers from different ASNs,
//   registrars, and continents means blocking all of them simultaneously
//   requires the censor to accept massive collateral damage to legitimate traffic.
//
// Inspired by:
//   pion/webrtc ICE agent: gathers candidates from all configured servers in
//   parallel; the first successful reflexive candidate unblocks the connection.
// ─────────────────────────────────────────────────────────────────────────────

import type { IceConfig } from '../types';

// ── Public STUN servers ───────────────────────────────────────────────────────
// Grouped so the browser sends parallel binding requests to all of them.
// Diversity: Google, Cloudflare, Mozilla, German telcos, Canadian VoIP,
//            independent operators, open-source projects, French/Dutch ISPs.
const STUN_SERVERS: RTCIceServer[] = [
  // Tier-1 CDNs (widely reachable, also widely targeted by censors)
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: ['stun:stun.cloudflare.com:3478'] },

  // Mozilla (non-commercial, different infra from Google/CF)
  { urls: ['stun:stun.services.mozilla.com'] },

  // sipgate.de — Deutsche Telekom AG network, Germany
  { urls: ['stun:stun.sipgate.net:3478', 'stun:stun.sipgate.net:10000'] },

  // schlund.de / 1&1 IONOS — Germany, separate ASN from sipgate
  { urls: ['stun:stun.schlund.de'] },

  // ekiga.net — Canada, independent open-source VoIP project
  { urls: ['stun:stun.ekiga.net'] },

  // stunprotocol.org — community-maintained, anycast nodes
  { urls: ['stun:stun.stunprotocol.org:3478'] },

  // Nextcloud — EU-based open-source, hosted independently
  { urls: ['stun:stun.nextcloud.com:443'] },

  // voiparound.com — EU multi-carrier VoIP provider
  { urls: ['stun:stun.voiparound.com'] },

  // FreeSWITCH — open-source telco stack, US-hosted
  { urls: ['stun:stun.freeswitch.org'] },

  // CounterPath — Vancouver, commercial SIP/VoIP
  { urls: ['stun:stun.counterpath.net'] },

  // ideasip.com — independent US VoIP
  { urls: ['stun:stun.ideasip.com'] },

  // ipshka.com — Eastern Europe
  { urls: ['stun:stun.ipshka.com'] },

  // voys.nl — Netherlands, small regional ISP
  { urls: ['stun:stun.voys.nl'] },

  // ippi.fr — France, independent VoIP operator
  { urls: ['stun:stun.ippi.fr:3478'] },
];

// ── TURN multi-transport builder ──────────────────────────────────────────────
// For each TURN hostname, emit three RTCIceServer entries covering:
//   1. UDP 3478  — standard, lowest latency
//   2. TCP 443   — bypasses UDP blocking, looks like HTTPS to DPI
//   3. TLS  443  — fully TLS-encrypted, indistinguishable from HTTPS
//
// The browser tries all three in parallel; the first that negotiates a
// candidate-pair wins. TCP/TLS on 443 adds ~5-20 ms latency vs UDP but
// penetrates virtually every corporate firewall and national filter.
function buildTurnEntries(
  host: string,
  username: string,
  credential: string,
): RTCIceServer[] {
  return [
    { urls: `turn:${host}:3478`,             username, credential },
    { urls: `turn:${host}:443?transport=tcp`, username, credential },
    { urls: `turns:${host}:443?transport=tcp`, username, credential },
  ];
}

// ── Load TURN servers from env vars ──────────────────────────────────────────
// Primary:   VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL
// Secondary: VITE_TURN_URL_2 / VITE_TURN_URL_2_USERNAME / _CREDENTIAL  (etc.)
//
// Deploy coturn (or OpenRelay.metered.ca) instances in different jurisdictions:
//   DE → VITE_TURN_URL=turn:turn-de.example.com:3478
//   SG → VITE_TURN_URL_2=turn:turn-sg.example.com:3478
//   US → VITE_TURN_URL_3=turn:turn-us.example.com:3478
//
// All TURN traffic is tunnelled through the Hysteria2 QUIC relay if the
// Capacitor native app has the Hysteria client plugin installed.
function loadTurnServers(): RTCIceServer[] {
  const out: RTCIceServer[] = [];

  // Primary (backwards-compatible with existing VITE_TURN_URL)
  const url1 = import.meta.env.VITE_TURN_URL as string | undefined;
  if (url1) {
    const host = url1.replace(/^turns?:/, '').replace(/[:?].*$/, '');
    out.push(
      ...buildTurnEntries(
        host,
        import.meta.env.VITE_TURN_USERNAME as string,
        import.meta.env.VITE_TURN_CREDENTIAL as string,
      ),
    );
  }

  // Additional TURN servers (VITE_TURN_URL_2 … VITE_TURN_URL_4)
  for (const n of [2, 3, 4] as const) {
    const urlN  = import.meta.env[`VITE_TURN_URL_${n}`]            as string | undefined;
    const userN = import.meta.env[`VITE_TURN_URL_${n}_USERNAME`]   as string | undefined;
    const credN = import.meta.env[`VITE_TURN_URL_${n}_CREDENTIAL`] as string | undefined;
    if (urlN && userN && credN) {
      const host = urlN.replace(/^turns?:/, '').replace(/[:?].*$/, '');
      out.push(...buildTurnEntries(host, userN, credN));
    }
  }

  return out;
}

// ── Exported config ───────────────────────────────────────────────────────────
export const RESILIENT_ICE_CONFIG: IceConfig = {
  iceServers: [...STUN_SERVERS, ...loadTurnServers()],
  // 'all' = attempt direct P2P first (lowest latency), fall through STUN
  // reflexive candidates, then TURN relay as last resort.
  // Switch to 'relay' only in environments where you know direct P2P is
  // impossible (e.g. symmetric NAT behind a carrier-grade NAT).
  iceTransportPolicy: 'all',
};

// ── Selector used by chat.ts DEFAULT_ICE_CONFIG ────────────────────────────
export function selectIceConfig(): IceConfig {
  return RESILIENT_ICE_CONFIG;
}
