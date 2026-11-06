import { act, fireEvent, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { renderInApp } from "../testing";
import type { PushDevice, PushPermission } from "./push-device";
import { PushProvider, PushSettingsNote, useAskForPush, type PushSystem } from "./PushNotifications";

/** This device's Push notifications, as the person left them. */
function fakeDevice(start: PushPermission) {
  let permission = start;
  return {
    permission: jest.fn(async () => permission),
    allow: jest.fn(async () => (permission = "allowed")),
    decline: jest.fn(async () => void (permission = "declined")),
    sync: jest.fn(async () => {}),
    forget: jest.fn(async () => {}),
  } satisfies PushDevice;
}

/** The system's side: a notification the test taps, a token it rotates, the device's settings. */
function fakeSystem() {
  const handlers: { tap: (response: unknown) => void; rotate: () => void } = { tap: () => {}, rotate: () => {} };
  const openSettings = jest.fn();
  const calls: PushSystem = {
    onTapped: (onTap) => ((handlers.tap = onTap), () => {}),
    onTokenRotated: (onRotate) => ((handlers.rotate = onRotate), () => {}),
    openSettings: () => openSettings(),
  };
  return { tap: (response: unknown) => handlers.tap(response), rotate: () => handlers.rotate(), openSettings, calls };
}

/** A page that starts a Job Search, or adds an Interview: where the app asks. */
function Starting({ context }: { context: "jobSearch" | "interview" }) {
  const ask = useAskForPush();
  return (
    <Pressable role="button" onPress={() => ask(context)}>
      <Text>Lancer</Text>
    </Pressable>
  );
}

async function render(device: PushDevice, ui = <Starting context="jobSearch" />) {
  const system = fakeSystem();
  const navigate = jest.fn();
  await renderInApp(
    <PushProvider device={device} system={system.calls} navigate={navigate}>
      {ui}
    </PushProvider>,
  );
  await act(async () => {});
  return { system, navigate };
}

const start = () => act(async () => fireEvent.press(screen.getByRole("button", { name: "Lancer" })));

describe("asking for Push notifications in context (#699)", () => {
  it("asks nothing at first launch", async () => {
    const device = fakeDevice("notAsked");
    await render(device);
    expect(screen.queryByText("Être prévenu des nouveaux résultats ?")).toBeNull();
    expect(device.allow).not.toHaveBeenCalled();
  });

  it("starting a Job Search, explains first, then asks the system once the person accepts", async () => {
    const device = fakeDevice("notAsked");
    await render(device);
    await start();
    expect(screen.getByText("Être prévenu des nouveaux résultats ?")).toBeOnTheScreen();
    expect(screen.getByText(/ne nomme jamais une entreprise, un poste ni une personne/)).toBeOnTheScreen();
    expect(device.allow).not.toHaveBeenCalled();

    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Activer les notifications" })));

    expect(device.allow).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Être prévenu des nouveaux résultats ?")).toBeNull();
  });

  it("adding an Interview, explains with its own words", async () => {
    await render(fakeDevice("notAsked"), <Starting context="interview" />);
    await start();
    expect(screen.getByText("Être prévenu la veille de vos rendez-vous ?")).toBeOnTheScreen();
  });

  it("keeps « Pas maintenant »: not asked again in context", async () => {
    const device = fakeDevice("notAsked");
    await render(device);
    await start();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Pas maintenant" })));
    expect(device.decline).toHaveBeenCalledTimes(1);

    await start();
    expect(screen.queryByText("Être prévenu des nouveaux résultats ?")).toBeNull();
    expect(device.allow).not.toHaveBeenCalled();
  });

  it.each(["allowed", "refused"] as const)("asks nothing once %s", async (permission) => {
    const device = fakeDevice(permission);
    await render(device);
    await start();
    expect(screen.queryByText("Être prévenu des nouveaux résultats ?")).toBeNull();
    expect(device.allow).not.toHaveBeenCalled();
  });
});

describe("the device's registration and the notifications tapped (#699)", () => {
  it("registers the device at start, and again when the system rotates its token", async () => {
    const device = fakeDevice("allowed");
    const { system } = await render(device);
    expect(device.sync).toHaveBeenCalledTimes(1);
    await act(async () => system.rotate());
    expect(device.sync).toHaveBeenCalledTimes(2);
  });

  it("opens the object a tapped notification names, and nothing for one it does not know", async () => {
    const { system, navigate } = await render(fakeDevice("allowed"));
    await act(async () => system.tap({ notification: { request: { content: { data: { path: "/candidatures/app-1" } } } } }));
    await act(async () => system.tap({ notification: { request: { content: { data: { path: "https://evil.example/" } } } } }));
    expect(navigate.mock.calls).toEqual([["/candidatures/app-1"]]);
  });
});

describe("Rappels, on the device (#699)", () => {
  it("explains how to turn notifications back on in the device's settings once refused, and opens them", async () => {
    const { system } = await render(fakeDevice("refused"), <PushSettingsNote />);
    expect(screen.getByText(/Les notifications de Jobbbox sont refusées sur cet appareil/)).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Ouvrir les Réglages" })));
    expect(system.openSettings).toHaveBeenCalledTimes(1);
  });

  it("offers to turn them on after « Pas maintenant »", async () => {
    const device = fakeDevice("declined");
    await render(device, <PushSettingsNote />);
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Activer les notifications" })));
    expect(device.allow).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Activer les notifications" })).toBeNull();
  });

  it("says nothing once allowed", async () => {
    await render(fakeDevice("allowed"), <PushSettingsNote />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
