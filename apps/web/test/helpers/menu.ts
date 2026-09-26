import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Opens a menu and chooses the option of that name. */
export async function chooseFromMenu(
  user: UserEvent,
  menu: HTMLElement,
  option: string | RegExp,
): Promise<void> {
  await user.click(menu);
  await user.click(screen.getByRole("option", { name: option }));
}
