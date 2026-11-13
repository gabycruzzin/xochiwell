import AVFoundation
import Capacitor
import PhotosUI
import UIKit
import Vision

// The app's web view controller, so the app's own plugins below can be registered with Capacitor.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LabelReaderPlugin())
    }
}

// Reads the text on a photo of a nutrition facts label, on the phone with Apple's Vision text recognition.
// Nothing is uploaded. JavaScript gets back each piece of text with where it sits in the photo
// (fractions of the photo, from its bottom-left corner) and turns that into numbers (src/labelParse.ts).
@objc(LabelReaderPlugin)
public class LabelReaderPlugin: CAPPlugin, CAPBridgedPlugin, UIImagePickerControllerDelegate, UINavigationControllerDelegate, PHPickerViewControllerDelegate {
    public let identifier = "LabelReaderPlugin"
    public let jsName = "LabelReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
    ]

    private var pending: CAPPluginCall?

    // Asks whether to take a photo or pick one, then reads it. Rejects with code "cancelled" if closed,
    // "camera-denied" if camera access is off, or "unreadable" if the photo couldn't be read.
    @objc func read(_ call: CAPPluginCall) {
        pending?.reject("Another photo is being read", "busy")
        pending = call
        DispatchQueue.main.async { self.chooseSource() }
    }

    private func chooseSource() {
        guard let vc = bridge?.viewController else { return fail("The app isn't ready", "unavailable") }
        let sheet = UIAlertController(title: "Nutrition label", message: "Get the whole Nutrition Facts panel in the photo, flat and in focus.", preferredStyle: .actionSheet)
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            sheet.addAction(UIAlertAction(title: "Take Photo", style: .default) { _ in self.openCamera() })
        }
        sheet.addAction(UIAlertAction(title: "Choose from Library", style: .default) { _ in self.openLibrary() })
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in self.fail("Cancelled", "cancelled") })
        if let pop = sheet.popoverPresentationController { // iPad shows action sheets as popovers
            pop.sourceView = vc.view
            pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
            pop.permittedArrowDirections = []
        }
        vc.present(sheet, animated: true)
    }

    private func openCamera() {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .denied || status == .restricted {
            return fail("Camera access is off", "camera-denied")
        }
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = self
        bridge?.viewController?.present(picker, animated: true)
    }

    private func openLibrary() {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        bridge?.viewController?.present(picker, animated: true)
    }

    public func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        guard let image = info[.originalImage] as? UIImage else { return fail("No photo", "unreadable") }
        recognize(image)
    }

    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        fail("Cancelled", "cancelled")
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else {
            return fail("Cancelled", "cancelled")
        }
        provider.loadObject(ofClass: UIImage.self) { object, _ in
            guard let image = object as? UIImage else { return self.fail("Couldn't open that photo", "unreadable") }
            self.recognize(image)
        }
    }

    private func recognize(_ image: UIImage) {
        guard let cgImage = image.cgImage else { return fail("Couldn't open that photo", "unreadable") }
        let request = VNRecognizeTextRequest { request, error in
            let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
            let pieces: [[String: Any]] = observations.compactMap { o in
                guard let text = o.topCandidates(1).first?.string else { return nil }
                let b = o.boundingBox
                return ["text": text, "x": b.minX, "y": b.minY, "w": b.width, "h": b.height]
            }
            if let error = error { return self.fail(error.localizedDescription, "unreadable") }
            self.resolve(["pieces": pieces])
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false // labels are mostly numbers and units, which "correction" can mangle
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: CGImagePropertyOrientation(image.imageOrientation))
        DispatchQueue.global(qos: .userInitiated).async {
            do { try handler.perform([request]) } catch { self.fail(error.localizedDescription, "unreadable") }
        }
    }

    private func resolve(_ data: [String: Any]) {
        DispatchQueue.main.async {
            self.pending?.resolve(data)
            self.pending = nil
        }
    }

    private func fail(_ message: String, _ code: String) {
        DispatchQueue.main.async {
            self.pending?.reject(message, code)
            self.pending = nil
        }
    }
}

extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .upMirrored: self = .upMirrored
        case .down: self = .down
        case .downMirrored: self = .downMirrored
        case .left: self = .left
        case .leftMirrored: self = .leftMirrored
        case .right: self = .right
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
