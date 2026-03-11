import { MissingLabel } from "@missing/vendor";

export function MockRuntimeTree() {
  const userInputService = game.GetService("UserInputService");
  return (
    <frame>
      <textlabel Text={userInputService.GetLastInputType()} />
      <MissingLabel />
    </frame>
  );
}

export { MissingLabel };
