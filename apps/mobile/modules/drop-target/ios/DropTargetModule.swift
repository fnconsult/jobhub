import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

/// The conversation's box as a drop target on iPadOS (#696): the view the box sits in (src/attach/DropTarget.tsx).
public class DropTargetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("JobbboxDropTarget")

    View(DropTargetView.self) {
      Events("onDropItems")
    }
  }
}

/// Takes the first thing dropped on it: a PDF or Word file, copied into the app's caches and sent as its file; a link
/// or text, sent as its text. The app decides what to do with it (src/attach/attachment.ts), the server what it is.
class DropTargetView: ExpoView, UIDropInteractionDelegate {
  let onDropItems = EventDispatcher()

  /// The Word file's type, known by its extension: the system declares no constant for it.
  private static let docx = UTType(filenameExtension: "docx") ?? UTType.data
  private static let files: [UTType] = [.pdf, docx]

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addInteraction(UIDropInteraction(delegate: self))
  }

  func dropInteraction(_ interaction: UIDropInteraction, canHandle session: UIDropSession) -> Bool {
    session.hasItemsConforming(toTypeIdentifiers: (DropTargetView.files + [.url, .plainText]).map(\.identifier))
  }

  func dropInteraction(_ interaction: UIDropInteraction, sessionDidUpdate session: UIDropSession) -> UIDropProposal {
    UIDropProposal(operation: .copy)
  }

  func dropInteraction(_ interaction: UIDropInteraction, performDrop session: UIDropSession) {
    guard let provider = session.items.first?.itemProvider else { return }
    if let type = DropTargetView.files.first(where: { provider.hasItemConformingToTypeIdentifier($0.identifier) }) {
      let name = provider.suggestedName.map { $0.hasSuffix(".\(type.preferredFilenameExtension ?? "")") ? $0 : "\($0).\(type.preferredFilenameExtension ?? "")" }
      provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { [weak self] url, _ in
        guard let url, let copy = DropTargetView.cached(url, named: name ?? url.lastPathComponent) else { return }
        let size = (try? copy.resourceValues(forKeys: [.fileSizeKey]))?.fileSize
        self?.send([
          "kind": "file",
          "uri": copy.absoluteString,
          "name": copy.lastPathComponent,
          "size": size as Any,
          "mimeType": type.preferredMIMEType as Any,
        ])
      }
    } else if provider.canLoadObject(ofClass: URL.self) {
      _ = provider.loadObject(ofClass: URL.self) { [weak self] url, _ in
        if let url { self?.send(["kind": "text", "text": url.absoluteString]) }
      }
    } else if provider.canLoadObject(ofClass: String.self) {
      _ = provider.loadObject(ofClass: String.self) { [weak self] text, _ in
        if let text { self?.send(["kind": "text", "text": text]) }
      }
    }
  }

  private func send(_ item: [String: Any]) {
    DispatchQueue.main.async { self.onDropItems(["items": [item]]) }
  }

  /// The system removes a dropped file once the load returns: a copy in the app's caches is what the app sends.
  private static func cached(_ url: URL, named name: String) -> URL? {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("dropped", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let copy = folder.appendingPathComponent(UUID().uuidString, isDirectory: true).appendingPathComponent(name)
    do {
      try FileManager.default.createDirectory(at: copy.deletingLastPathComponent(), withIntermediateDirectories: true)
      try FileManager.default.copyItem(at: url, to: copy)
      return copy
    } catch {
      return nil
    }
  }
}
