import { screen } from "@testing-library/react-native";
import { LOGO } from "@jobhub/shared/logo";
import { renderInApp } from "../testing";
import { Logo } from "./Logo";

describe("the logo's symbol in the app (#988, ADR-0105)", () => {
  it("draws the bubble and the three dots of the coach answering, at the size it is given", async () => {
    await renderInApp(<Logo size={28} testID="logo" />);
    const logo = screen.getByTestId("logo", { includeHiddenElements: true });
    expect(logo.props.width).toBe(28);
    expect(logo.props.height).toBe(28);
    const drawn = JSON.stringify(screen.toJSON());
    expect(drawn.match(/"type":"RNSVGCircle"/g)).toHaveLength(3);
    expect(drawn).toContain(LOGO.bubble);
  });

  it("is decorative: the name beside it says « Jobbbox »", async () => {
    await renderInApp(<Logo size={28} testID="logo" />);
    const logo = screen.getByTestId("logo", { includeHiddenElements: true });
    expect(logo.props.accessible).toBe(false);
    expect(logo.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(screen.queryByTestId("logo")).toBeNull();
  });
});
