import ExpoModulesCore
import UIKit

/// A shortcut as the app's JavaScript registers it (src/keyboard/key-commands.tsx).
struct KeyCommandRecord: Record {
  @Field var id: String = ""
  /// "n", "Enter", "\\", "i", "w" or "Escape".
  @Field var input: String = ""
  /// "command", or none for Escape.
  @Field var modifier: String?
  @Field var title: String = ""
}

/// The hardware keyboard's shortcuts on iPadOS (#700): each one a `UIKeyCommand` on the window's root view controller,
/// which is in every responder chain, a text field's included, so ⌘↩ sends while the box has the focus. Its title is
/// what the ⌘ panel lists when the person holds ⌘; pressing it sends its id to JavaScript (`onKeyCommand`).
public class KeyCommandsModule: Module {
  fileprivate static weak var current: KeyCommandsModule?
  private var registered: [UIKeyCommand] = []
  private weak var holder: UIViewController?

  public func definition() -> ModuleDefinition {
    Name("JobbboxKeyCommands")

    Events("onKeyCommand")

    OnCreate {
      KeyCommandsModule.current = self
    }

    Function("setCommands") { (records: [KeyCommandRecord]) in
      let specs = records.map { (id: $0.id, input: $0.input, modified: $0.modifier != nil, title: $0.title) }
      Task { @MainActor in
        self.install(specs.map { KeyCommandsModule.keyCommand(id: $0.id, input: $0.input, modified: $0.modified, title: $0.title) })
      }
    }

    OnDestroy {
      Task { @MainActor in
        self.install([])
      }
    }
  }

  /// Replaces the registered shortcuts, on the root view controller of the moment (a development build may swap it).
  @MainActor
  private func install(_ keyCommands: [UIKeyCommand]) {
    registered.forEach { holder?.removeKeyCommand($0) }
    holder = Utilities.keyWindow()?.rootViewController
    keyCommands.forEach { holder?.addKeyCommand($0) }
    registered = keyCommands
  }

  fileprivate func fire(_ command: UIKeyCommand) {
    guard let id = command.propertyList as? String else { return }
    sendEvent("onKeyCommand", ["id": id])
  }

  @MainActor
  private static func keyCommand(id: String, input: String, modified: Bool, title: String) -> UIKeyCommand {
    let command = UIKeyCommand(
      title: title,
      action: #selector(UIResponder.jobbboxPerformKeyCommand(_:)),
      input: KeyCommandsModule.uiKitInput(input),
      modifierFlags: modified ? .command : [],
      propertyList: id
    )
    command.discoverabilityTitle = title
    // ⌘W and Escape before the system's own use of them while the app is in front, ⌘↩ before the text field's.
    command.wantsPriorityOverSystemBehavior = true
    return command
  }

  private static func uiKitInput(_ input: String) -> String {
    switch input {
    case "Enter": return "\r"
    case "Escape": return UIKeyCommand.inputEscape
    default: return input
    }
  }
}

extension UIResponder {
  /// Every responder answers the shortcuts' action, so UIKit finds it from whatever has the focus.
  @objc func jobbboxPerformKeyCommand(_ sender: UIKeyCommand) {
    KeyCommandsModule.current?.fire(sender)
  }
}
