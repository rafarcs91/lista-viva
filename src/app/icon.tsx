import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * O check é o gesto central do app. Desenhado como path, não como o
 * caractere "✓": um glifo obrigaria a baixar uma fonte no build, e essa
 * busca falha em rede fechada — o ícone sairia como um quadrado vazio.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0EA97A",
          borderRadius: 7,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path
            d="M5 12.5 10 17.5 19 7.5"
            fill="none"
            stroke="#fff"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    size,
  );
}
