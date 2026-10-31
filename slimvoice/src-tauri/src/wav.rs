//! 16-Bit-PCM (mono) ↔ WAV, und Aufteilen langer Aufnahmen in Stücke, die die Dienste annehmen.

pub const SAMPLE_RATE: u32 = 16_000;

pub fn encode_wav(pcm: &[i16]) -> Vec<u8> {
    let data_bytes = (pcm.len() * 2) as u32;
    let mut b = Vec::with_capacity(44 + data_bytes as usize);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes()); // PCM
    b.extend_from_slice(&1u16.to_le_bytes()); // mono
    b.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    b.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&data_bytes.to_le_bytes());
    for s in pcm {
        b.extend_from_slice(&s.to_le_bytes());
    }
    b
}

/// WAV-Datei lesen (16 Bit PCM, beliebige Rate/Kanäle) → (Mono-Samples −1…1, Rate)
pub fn decode_wav(bytes: &[u8]) -> Option<(Vec<f32>, u32)> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut i = 12;
    let (mut channels, mut rate, mut bits) = (1u16, 16_000u32, 16u16);
    while i + 8 <= bytes.len() {
        let id = &bytes[i..i + 4];
        let size = u32::from_le_bytes(bytes[i + 4..i + 8].try_into().ok()?) as usize;
        let body = i + 8;
        if id == b"fmt " {
            channels = u16::from_le_bytes(bytes[body + 2..body + 4].try_into().ok()?);
            rate = u32::from_le_bytes(bytes[body + 4..body + 8].try_into().ok()?);
            bits = u16::from_le_bytes(bytes[body + 14..body + 16].try_into().ok()?);
        } else if id == b"data" {
            if bits != 16 {
                return None;
            }
            let end = (body + size).min(bytes.len());
            let ch = channels.max(1) as usize;
            let samples: Vec<i16> = bytes[body..end]
                .chunks_exact(2)
                .map(|c| i16::from_le_bytes([c[0], c[1]]))
                .collect();
            let mono = samples
                .chunks(ch)
                .map(|f| f.iter().map(|&s| s as f32 / 32768.0).sum::<f32>() / ch as f32)
                .collect();
            return Some((mono, rate));
        }
        i = body + size + (size & 1);
    }
    None
}

/// Abschnitte hintereinander, mit kurzer Stille dazwischen
pub fn concat_pcm(chunks: &[Vec<i16>], gap_ms: u32) -> Vec<i16> {
    let gap = (gap_ms * SAMPLE_RATE / 1000) as usize;
    let mut out = Vec::new();
    for (i, c) in chunks.iter().enumerate() {
        if i > 0 {
            out.extend(std::iter::repeat(0).take(gap));
        }
        out.extend_from_slice(c);
    }
    out
}

/// Abschnitte zu Gruppen von höchstens max_seconds zusammenfassen (Grenzen nur an Sprechpausen)
pub fn group_chunks(chunks: &[Vec<i16>], max_seconds: u32) -> Vec<Vec<Vec<i16>>> {
    let max = (max_seconds * SAMPLE_RATE) as usize;
    let mut groups = Vec::new();
    let mut cur: Vec<Vec<i16>> = Vec::new();
    let mut len = 0;
    for c in chunks {
        if !cur.is_empty() && len + c.len() > max {
            groups.push(std::mem::take(&mut cur));
            len = 0;
        }
        len += c.len();
        cur.push(c.clone());
    }
    if !cur.is_empty() {
        groups.push(cur);
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_hin_und_zurueck() {
        let pcm = vec![0i16, 1000, -1000, 32767];
        let w = encode_wav(&pcm);
        assert_eq!(w.len(), 44 + 8);
        let (back, rate) = decode_wav(&w).unwrap();
        assert_eq!(rate, 16_000);
        assert!((back[1] - 1000.0 / 32768.0).abs() < 1e-6);
    }

    #[test]
    fn gruppen() {
        let c = vec![vec![0i16; 16_000 * 4]; 3];
        assert_eq!(
            group_chunks(&c, 9)
                .iter()
                .map(|g| g.len())
                .collect::<Vec<_>>(),
            vec![2, 1]
        );
        assert_eq!(concat_pcm(&[vec![1; 10], vec![1; 10]], 1).len(), 36);
    }
}
