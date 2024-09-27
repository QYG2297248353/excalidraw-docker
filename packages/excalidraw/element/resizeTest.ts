import type {
  ExcalidrawElement,
  PointerType,
  NonDeletedExcalidrawElement,
  ElementsMap,
  Bounds,
} from "./types";

import type {
  TransformHandleType,
  TransformHandle,
  MaybeTransformHandleType,
} from "./transformHandles";
import {
  getTransformHandlesFromCoords,
  getTransformHandles,
  getOmitSidesForDevice,
  canResizeFromSides,
} from "./transformHandles";
import type { AppState, Device, Zoom } from "../types";
import { getElementAbsoluteCoords } from "./bounds";
import { SIDE_RESIZING_THRESHOLD } from "../constants";
import { isLinearElement } from "./typeChecks";
import type { GlobalPoint, Segment, LocalPoint } from "../../math";
import {
  point,
  segmentIncludesPoint,
  pointRotateRads,
  type Radians,
} from "../../math";

const isInsideTransformHandle = (
  transformHandle: TransformHandle,
  x: number,
  y: number,
) =>
  x >= transformHandle[0] &&
  x <= transformHandle[0] + transformHandle[2] &&
  y >= transformHandle[1] &&
  y <= transformHandle[1] + transformHandle[3];

export const resizeTest = <Point extends GlobalPoint | LocalPoint>(
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  appState: AppState,
  x: number,
  y: number,
  zoom: Zoom,
  pointerType: PointerType,
  device: Device,
): MaybeTransformHandleType => {
  if (!appState.selectedElementIds[element.id]) {
    return false;
  }

  const { rotation: rotationTransformHandle, ...transformHandles } =
    getTransformHandles(
      element,
      zoom,
      elementsMap,
      pointerType,
      getOmitSidesForDevice(device),
    );

  if (
    rotationTransformHandle &&
    isInsideTransformHandle(rotationTransformHandle, x, y)
  ) {
    return "rotation" as TransformHandleType;
  }

  const filter = Object.keys(transformHandles).filter((key) => {
    const transformHandle =
      transformHandles[key as Exclude<TransformHandleType, "rotation">]!;
    if (!transformHandle) {
      return false;
    }
    return isInsideTransformHandle(transformHandle, x, y);
  });

  if (filter.length > 0) {
    return filter[0] as TransformHandleType;
  }

  if (canResizeFromSides(device)) {
    const [x1, y1, x2, y2, cx, cy] = getElementAbsoluteCoords(
      element,
      elementsMap,
    );

    // do not resize from the sides for linear elements with only two points
    if (!(isLinearElement(element) && element.points.length <= 2)) {
      const SPACING = SIDE_RESIZING_THRESHOLD / zoom.value;
      const sides = getSelectionBorders(
        point<Point>(x1 - SPACING, y1 - SPACING),
        point(x2 + SPACING, y2 + SPACING),
        point(cx, cy),
        element.angle,
      );

      for (const [dir, side] of Object.entries(sides)) {
        // test to see if x, y are on the line segment
        if (
          segmentIncludesPoint(
            point<Point>(x, y),
            side as Segment<Point>,
            SPACING,
          )
        ) {
          return dir as TransformHandleType;
        }
      }
    }
  }

  return false;
};

export const getElementWithTransformHandleType = (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: AppState,
  scenePointer: GlobalPoint,
  zoom: Zoom,
  pointerType: PointerType,
  elementsMap: ElementsMap,
  device: Device,
) => {
  return elements.reduce((result, element) => {
    if (result) {
      return result;
    }
    const transformHandleType = resizeTest(
      element,
      elementsMap,
      appState,
      scenePointer[0],
      scenePointer[1],
      zoom,
      pointerType,
      device,
    );
    return transformHandleType ? { element, transformHandleType } : null;
  }, null as { element: NonDeletedExcalidrawElement; transformHandleType: MaybeTransformHandleType } | null);
};

export const getTransformHandleTypeFromCoords = (
  [x1, y1, x2, y2]: Bounds,
  scenePointer: GlobalPoint,
  zoom: Zoom,
  pointerType: PointerType,
  device: Device,
): MaybeTransformHandleType => {
  const transformHandles = getTransformHandlesFromCoords(
    [x1, y1, x2, y2, (x1 + x2) / 2, (y1 + y2) / 2],
    0 as Radians,
    zoom,
    pointerType,
    getOmitSidesForDevice(device),
  );

  const found = Object.keys(transformHandles).find((key) => {
    const transformHandle =
      transformHandles[key as Exclude<TransformHandleType, "rotation">]!;
    return (
      transformHandle &&
      isInsideTransformHandle(transformHandle, scenePointer[0], scenePointer[1])
    );
  });

  if (found) {
    return found as MaybeTransformHandleType;
  }

  if (canResizeFromSides(device)) {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;

    const SPACING = SIDE_RESIZING_THRESHOLD / zoom.value;

    const sides = getSelectionBorders(
      point<GlobalPoint>(x1 - SPACING, y1 - SPACING),
      point(x2 + SPACING, y2 + SPACING),
      point(cx, cy),
      0 as Radians,
    );

    for (const [dir, side] of Object.entries(sides)) {
      // test to see if x, y are on the line segment
      if (
        segmentIncludesPoint(
          scenePointer,
          side as Segment<GlobalPoint>,
          SPACING,
        )
      ) {
        return dir as TransformHandleType;
      }
    }
  }

  return false;
};

const RESIZE_CURSORS = ["ns", "nesw", "ew", "nwse"];
const rotateResizeCursor = (cursor: string, angle: number) => {
  const index = RESIZE_CURSORS.indexOf(cursor);
  if (index >= 0) {
    const a = Math.round(angle / (Math.PI / 4));
    cursor = RESIZE_CURSORS[(index + a) % RESIZE_CURSORS.length];
  }
  return cursor;
};

/*
 * Returns bi-directional cursor for the element being resized
 */
export const getCursorForResizingElement = (resizingElement: {
  element?: ExcalidrawElement;
  transformHandleType: MaybeTransformHandleType;
}): string => {
  const { element, transformHandleType } = resizingElement;
  const shouldSwapCursors =
    element && Math.sign(element.height) * Math.sign(element.width) === -1;
  let cursor = null;

  switch (transformHandleType) {
    case "n":
    case "s":
      cursor = "ns";
      break;
    case "w":
    case "e":
      cursor = "ew";
      break;
    case "nw":
    case "se":
      if (shouldSwapCursors) {
        cursor = "nesw";
      } else {
        cursor = "nwse";
      }
      break;
    case "ne":
    case "sw":
      if (shouldSwapCursors) {
        cursor = "nwse";
      } else {
        cursor = "nesw";
      }
      break;
    case "rotation":
      return "grab";
  }

  if (cursor && element) {
    cursor = rotateResizeCursor(cursor, element.angle);
  }

  return cursor ? `${cursor}-resize` : "";
};

const getSelectionBorders = <Point extends LocalPoint | GlobalPoint>(
  [x1, y1]: Point,
  [x2, y2]: Point,
  center: Point,
  angle: Radians,
) => {
  const topLeft = pointRotateRads(point(x1, y1), center, angle);
  const topRight = pointRotateRads(point(x2, y1), center, angle);
  const bottomLeft = pointRotateRads(point(x1, y2), center, angle);
  const bottomRight = pointRotateRads(point(x2, y2), center, angle);

  return {
    n: [topLeft, topRight],
    e: [topRight, bottomRight],
    s: [bottomRight, bottomLeft],
    w: [bottomLeft, topLeft],
  };
};
