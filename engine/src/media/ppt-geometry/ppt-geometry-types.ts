import type { PptGeometryImageDimensions } from './ppt-geometry-qa-image.js'
export const EMUS_PER_POINT = 12_700

export type PptGeometrySize = { width: number; height: number }
export type PptGeometryRect = { x: number; y: number; width: number; height: number }
export type PptGeometryCrop = { left: number; top: number; right: number; bottom: number }
export type PptGeometryShapeKind = 'shape' | 'picture' | 'graphic' | 'connector'

export type PptGeometryTextRun = {
  text: string
  fontSizePt?: number
  visible: boolean
}

export type PptGeometryTextParagraph = {
  runs: PptGeometryTextRun[]
  lineSpacing?: { kind: 'percent' | 'points'; value: number }
  spaceBeforePt: number
  spaceAfterPt: number
}

export type PptGeometryText = {
  paragraphs: PptGeometryTextParagraph[]
  autoFit: boolean
  wrap: boolean
  insets: { left: number; top: number; right: number; bottom: number }
}

export type PptGeometryImage = {
  relationshipId?: string
  target?: string
  crop: PptGeometryCrop
  dimensions?: PptGeometryImageDimensions
  unreadableReason?: 'external' | 'missing-relationship' | 'missing-media' | 'unsupported-media'
}

export type PptGeometryShape = {
  id: string
  name?: string
  kind: PptGeometryShapeKind
  graphicKind?: 'chart' | 'table' | 'diagram' | 'other'
  zIndex: number
  rect: PptGeometryRect
  rotationDegrees: number
  groupId?: string
  visible: boolean
  opaque: boolean
  decoration: boolean
  informational: boolean
  footer: boolean
  text?: PptGeometryText
  image?: PptGeometryImage
}

export type PptGeometrySlide = {
  path: string
  index: number
  shapes: PptGeometryShape[]
}

export type PptGeometryDocument = {
  size: PptGeometrySize
  slides: PptGeometrySlide[]
}
