/** Resolve the live theme before serializing: data SVG images cannot inherit page CSS. */
export function chartPictureSource(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const original = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const copied = [clone, ...Array.from(clone.querySelectorAll("*"))];
  original.forEach((node, index) => {
    const style = getComputedStyle(node);
    for (const property of ["fill", "stroke", "stroke-width", "font-size", "font-family"]) {
      const value = style.getPropertyValue(property);
      if (value) (copied[index] as SVGElement).style.setProperty(property, value);
    }
  });
  const source = new XMLSerializer().serializeToString(clone);
  const encoded = Array.from(new TextEncoder().encode(source), byte => String.fromCharCode(byte)).join("");
  return `data:image/svg+xml;base64,${btoa(encoded)}`;
}

/** Original charts.js data-SVG/canvas path, retaining actual chart geometry and theme. */
export async function chartPng(svg: SVGSVGElement): Promise<string> {
  const viewBox = svg.getAttribute("viewBox")?.split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !Number.isFinite(viewBox[2]) || !Number.isFinite(viewBox[3]) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error("The chart has no usable picture size.");
  }
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The chart could not be turned into a picture."));
    image.src = chartPictureSource(svg);
  });
  const canvas = document.createElement("canvas");
  canvas.width = viewBox[2] * 2; canvas.height = viewBox[3] * 2;
  const pen = canvas.getContext("2d");
  if (!pen) throw new Error("This browser could not create the chart picture.");
  pen.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "white";
  pen.fillRect(0, 0, canvas.width, canvas.height);
  pen.drawImage(image, 0, 0, canvas.width, canvas.height);
  const picture = canvas.toDataURL("image/png");
  if (!picture.startsWith("data:image/png;base64,")) throw new Error("This browser could not create the chart picture.");
  return picture;
}

export function downloadChartPicture(picture: string, title: string): void {
  const link = document.createElement("a");
  link.href = picture;
  link.download = `${title.replace(/[^a-z0-9]+/gi, "-") || "chart"}.png`;
  link.click();
}
