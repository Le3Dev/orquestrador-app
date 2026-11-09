import "@testing-library/jest-dom/vitest";

// O jsdom não implementa URLs `blob:`; as miniaturas das imagens anexadas usam.
if (typeof URL.createObjectURL !== "function") {
  let proxima = 0;
  URL.createObjectURL = () => {
    proxima += 1;
    return `blob:teste/${proxima}`;
  };
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => undefined;
}
