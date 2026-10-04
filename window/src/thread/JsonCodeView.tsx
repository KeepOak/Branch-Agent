import type { Node } from "jsonc-parser";
import type { JsonCode } from "./json-code-view";
import "./json-code-view.css";

function JsonNode({ node, text, depth, name }: { node: Node; text: string; depth: number; name?: string }) {
  const children = node.children ?? [], array = node.type === "array";
  const container = array || node.type === "object";
  const prefix = name === undefined ? null : <span className="json-code-key">{name}: </span>;
  if (!container) return <div className="json-code-value">{prefix}<span data-json-literal={node.type}>{text.slice(node.offset, node.offset + node.length)}</span></div>;
  return <details className="json-code-node" open={depth < 2}>
    <summary>{prefix}{array ? `Array (${children.length} items)` : `Object (${children.length} keys)`}</summary>
    <div className="json-code-children">{children.map((child, index) => {
      const property = child.type === "property", key = property ? child.children?.[0] : undefined;
      const value = property ? child.children?.[1] : child;
      return value ? <JsonNode key={index} node={value} text={text} depth={depth + 1} name={key ? text.slice(key.offset, key.offset + key.length) : String(index)} /> : null;
    })}</div>
  </details>;
}

export function JsonCodeView({ json }: { json: JsonCode }) {
  return json.root ? <div className="json-code-tree"><JsonNode node={json.root} text={json.text} depth={0} /></div> : null;
}
