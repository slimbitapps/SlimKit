// Brücke zu Apples eingebauter Spracherkennung (dieselbe wie beim Mac-Diktat).
// Läuft auf dem Gerät (Neural Engine), liefert schon während des Sprechens Zwischenergebnisse.
// Wird von Rust über einfache C-Funktionen aufgerufen (siehe src/apple.rs).

import AVFoundation
import Foundation
import Speech

/// kind: 0 = Zwischenergebnis, 1 = Endergebnis, 2 = Fehler
public typealias SVCallback = @convention(c) (UnsafeMutableRawPointer?, Int32, UnsafePointer<CChar>?) -> Void

final class SVSession {
    let recognizer: SFSpeechRecognizer
    let request = SFSpeechAudioBufferRecognitionRequest()
    let format: AVAudioFormat
    let queue = OperationQueue()
    var task: SFSpeechRecognitionTask?
    var cb: SVCallback?
    let user: UnsafeMutableRawPointer?
    var done = false

    init(recognizer: SFSpeechRecognizer, format: AVAudioFormat, cb: SVCallback, user: UnsafeMutableRawPointer?) {
        self.recognizer = recognizer
        self.format = format
        self.cb = cb
        self.user = user
        queue.maxConcurrentOperationCount = 1
    }

    /// Nur auf `queue` aufrufen
    func send(_ kind: Int32, _ text: String) {
        guard let cb = cb, !done else { return }
        if kind != 0 { done = true }
        text.withCString { cb(user, kind, $0) }
    }
}

/// „de“ → passende Apple-Sprache (z. B. „de-DE“), bevorzugt mit der Region des Systems
func pickLocale(_ lang: String) -> Locale {
    let supported = SFSpeechRecognizer.supportedLocales()
    if lang.isEmpty || lang == "auto" {
        return Locale.current
    }
    let want = lang.replacingOccurrences(of: "_", with: "-").lowercased()
    if let exact = supported.first(where: { $0.identifier.replacingOccurrences(of: "_", with: "-").lowercased() == want }) {
        return exact
    }
    let region = Locale.current.regionCode ?? ""
    let same = supported.filter { ($0.languageCode ?? "").lowercased() == want }
    if let r = same.first(where: { ($0.regionCode ?? "") == region }) {
        return r
    }
    // sinnvolle Standard-Regionen zuerst (de-DE, en-US …)
    let preferred = ["de": "DE", "en": "US", "fr": "FR", "es": "ES", "it": "IT", "pt": "BR", "nl": "NL"]
    if let pr = preferred[want], let r = same.first(where: { ($0.regionCode ?? "") == pr }) {
        return r
    }
    return same.first ?? Locale(identifier: lang)
}

/// Berechtigung: 0 = noch nicht gefragt, 1 = abgelehnt, 2 = eingeschränkt, 3 = erlaubt
@_cdecl("sv_apple_status")
public func sv_apple_status() -> Int32 {
    switch SFSpeechRecognizer.authorizationStatus() {
    case .notDetermined: return 0
    case .denied: return 1
    case .restricted: return 2
    case .authorized: return 3
    @unknown default: return 1
    }
}

/// Fragt nach der Berechtigung (Systemdialog) und wartet auf die Antwort. Nicht im Haupt-Thread aufrufen.
@_cdecl("sv_apple_request")
public func sv_apple_request() -> Int32 {
    let sem = DispatchSemaphore(value: 0)
    SFSpeechRecognizer.requestAuthorization { _ in sem.signal() }
    _ = sem.wait(timeout: .now() + 120)
    return sv_apple_status()
}

/// 0 = Sprache nicht verfügbar, 1 = nur über Apples Server, 2 = direkt auf dem Gerät
@_cdecl("sv_apple_available")
public func sv_apple_available(_ lang: UnsafePointer<CChar>?) -> Int32 {
    let l = lang.map { String(cString: $0) } ?? ""
    guard let r = SFSpeechRecognizer(locale: pickLocale(l)) else { return 0 }
    if r.supportsOnDeviceRecognition { return 2 }
    return r.isAvailable ? 1 : 0
}

/// Startet eine Erkennung (ein Satz/Abschnitt). hints: Fachwörter, mit \n getrennt.
@_cdecl("sv_apple_start")
public func sv_apple_start(
    _ lang: UnsafePointer<CChar>?, _ hints: UnsafePointer<CChar>?, _ allowServer: Int32,
    _ user: UnsafeMutableRawPointer?, _ cb: SVCallback?
) -> UnsafeMutableRawPointer? {
    guard let cb = cb else { return nil }
    let l = lang.map { String(cString: $0) } ?? ""
    guard let recognizer = SFSpeechRecognizer(locale: pickLocale(l)) else { return nil }
    guard let format = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1) else { return nil }
    let s = SVSession(recognizer: recognizer, format: format, cb: cb, user: user)
    recognizer.queue = s.queue
    s.request.shouldReportPartialResults = true
    s.request.taskHint = .dictation
    if recognizer.supportsOnDeviceRecognition {
        s.request.requiresOnDeviceRecognition = true
    } else if allowServer == 0 {
        return nil
    }
    if #available(macOS 13.0, *) {
        s.request.addsPunctuation = true
    }
    if let h = hints.map({ String(cString: $0) }), !h.isEmpty {
        s.request.contextualStrings = h.split(separator: "\n").map(String.init).filter { !$0.isEmpty }
    }
    s.task = recognizer.recognitionTask(with: s.request) { [weak s] result, error in
        guard let s = s else { return }
        if let r = result {
            s.send(r.isFinal ? 1 : 0, r.bestTranscription.formattedString)
            if r.isFinal { return }
        }
        if let e = error {
            let ns = e as NSError
            // „Keine Sprache erkannt“ ist kein echter Fehler → leeres Ergebnis
            if ns.code == 1110 || ns.code == 203 || ns.code == 216 || ns.code == 301 {
                s.send(1, "")
            } else {
                s.send(2, "\(ns.domain) \(ns.code): \(ns.localizedDescription)")
            }
        }
    }
    return Unmanaged.passRetained(s).toOpaque()
}

/// Audio nachliefern (16 kHz, Mono, 16 bit)
@_cdecl("sv_apple_feed")
public func sv_apple_feed(_ ptr: UnsafeMutableRawPointer?, _ pcm: UnsafePointer<Int16>?, _ n: Int32) {
    guard let ptr = ptr, let pcm = pcm, n > 0 else { return }
    let s = Unmanaged<SVSession>.fromOpaque(ptr).takeUnretainedValue()
    guard let buf = AVAudioPCMBuffer(pcmFormat: s.format, frameCapacity: AVAudioFrameCount(n)),
          let ch = buf.floatChannelData?[0] else { return }
    for i in 0..<Int(n) {
        ch[i] = Float(pcm[i]) / 32768.0
    }
    buf.frameLength = AVAudioFrameCount(n)
    s.request.append(buf)
}

/// Kein Audio mehr – das Endergebnis kommt danach über den Rückruf
@_cdecl("sv_apple_finish")
public func sv_apple_finish(_ ptr: UnsafeMutableRawPointer?) {
    guard let ptr = ptr else { return }
    let s = Unmanaged<SVSession>.fromOpaque(ptr).takeUnretainedValue()
    s.request.endAudio()
}

/// Aufräumen. Danach kommen garantiert keine Rückrufe mehr.
@_cdecl("sv_apple_free")
public func sv_apple_free(_ ptr: UnsafeMutableRawPointer?) {
    guard let ptr = ptr else { return }
    let s = Unmanaged<SVSession>.fromOpaque(ptr).takeRetainedValue()
    let op = BlockOperation {
        s.cb = nil
        s.done = true
    }
    s.queue.addOperations([op], waitUntilFinished: true)
    s.task?.cancel()
    s.task = nil
}
