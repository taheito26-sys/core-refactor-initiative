export function createPeerConnection(input: {
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) input.onIceCandidate(event.candidate.toJSON());
  };

  pc.onconnectionstatechange = () => {
    input.onConnectionStateChange?.(pc.connectionState);
  };

  return pc;
}

export async function ensureMicTrack(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

export function stopMediaStream(stream: MediaStream) {
  stream.getTracks().forEach((t) => t.stop());
}
