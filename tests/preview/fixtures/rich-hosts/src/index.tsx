import { React } from "@lattice-ui/core";

export function RichHostsPreview() {
  return (
    <frame BackgroundTransparency={1} BorderSizePixel={0} Size={UDim2.fromOffset(240, 180)}>
      <uilistlayout
        FillDirection={Enum.FillDirection.Vertical}
        Padding={new UDim(0, 10)}
        SortOrder={Enum.SortOrder.LayoutOrder}
      />
      <uipadding
        PaddingBottom={new UDim(0, 12)}
        PaddingLeft={new UDim(0, 12)}
        PaddingRight={new UDim(0, 12)}
        PaddingTop={new UDim(0, 12)}
      />
      <textlabel
        BackgroundTransparency={1}
        BorderSizePixel={0}
        Size={UDim2.fromOffset(216, 24)}
        Text="Rich host preview"
        TextColor3={Color3.fromRGB(20, 24, 32)}
        TextSize={14}
        TextXAlignment={Enum.TextXAlignment.Left}
      />
      <scrollingframe
        AutomaticCanvasSize={Enum.AutomaticSize.Y}
        BackgroundTransparency={1}
        BorderSizePixel={0}
        CanvasSize={UDim2.fromScale(0, 0)}
        ScrollingDirection={Enum.ScrollingDirection.Y}
        Size={UDim2.fromOffset(216, 96)}
      >
        <imagelabel
          BackgroundTransparency={1}
          BorderSizePixel={0}
          Image="https://example.com/preview.png"
          Size={UDim2.fromOffset(48, 48)}
        >
          <uicorner CornerRadius={new UDim(0, 12)} />
          <uistroke Thickness={1} />
        </imagelabel>
      </scrollingframe>
    </frame>
  );
}

export const RichHosts = {
  Preview: RichHostsPreview,
} as const;
