import Foundation
import Capacitor
import UIKit

@objc(PrivacyShieldPlugin)
public class PrivacyShieldPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrivacyShieldPlugin"
    public let jsName = "PrivacyShield"
    public let pluginMethods: [CAPPluginMethod] = []

    private var screenshotObserver: NSObjectProtocol?
    private var captureObserver: NSObjectProtocol?

    public override func load() {
        screenshotObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.userDidTakeScreenshotNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.emitPrivacySignal(source: "screenshot")
        }

        if #available(iOS 11.0, *) {
            captureObserver = NotificationCenter.default.addObserver(
                forName: UIScreen.capturedDidChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                let source = UIScreen.main.isCaptured ? "screen-recording-started" : "screen-recording-stopped"
                self?.emitPrivacySignal(source: source)
            }
        }
    }

    deinit {
        if let screenshotObserver = screenshotObserver {
            NotificationCenter.default.removeObserver(screenshotObserver)
        }
        if let captureObserver = captureObserver {
            NotificationCenter.default.removeObserver(captureObserver)
        }
    }

    private func emitPrivacySignal(source: String) {
        notifyListeners("privacyCaptureDetected", data: [
            "source": source,
            "platform": "ios"
        ], retainUntilConsumed: true)
    }
}
