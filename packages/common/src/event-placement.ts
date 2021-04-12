
export interface SegInput {
  index: number
  spanStart: number
  spanEnd: number
  thickness: number
  forceAbsolute?: boolean // TODO: kill
}

export interface SegEntry {
  segInput: SegInput
  spanStart: number
  spanEnd: number
  thickness: number
}

export interface SegRect extends SegEntry {
  partIndex: number
  levelCoord: number
}

export interface SegInsertion {
  levelCoord: number
  nextLevel: number
  lateralStart: number // within the previous level
  lateralEnd: number // within the previous level
  touchingEntry: SegEntry
  stackCnt: number
}

export class SegHierarchy {
  // settings
  allowReslicing: boolean = false
  maxCoord: number = -1 // -1 means no max
  maxStackCnt: number = -1 // -1 means no max

  levelCoords: number[] = [] // ordered
  entriesByLevel: SegEntry[][] = [] // parallel with levelCoords
  stackCnts: { [entryId: string]: number } = {} // TODO: use better technique!?

  addSegs(segInputs: SegInput[]): SegEntry[] {
    let hiddenEntries: SegEntry[] = []

    for (let segInput of segInputs) {
      this.insertEntry({
        segInput,
        spanStart: segInput.spanStart,
        spanEnd: segInput.spanEnd,
        thickness: segInput.thickness,
      }, hiddenEntries)
    }

    return hiddenEntries
  }

  insertEntry(entry: SegEntry, hiddenEntries: SegEntry[]): number {
    let insertion = this.findInsertion(entry)

    if (this.isInsertionValid(insertion, entry)) {
      this.insertEntryAt(entry, insertion)
      return 1

    } else {
      return this.handleInvalidInsertion(insertion, entry, hiddenEntries)
    }
  }

  isInsertionValid(insertion: SegInsertion, entry: SegEntry) {
    return (this.maxCoord === -1 || insertion.levelCoord + entry.thickness <= this.maxCoord) &&
      (this.maxStackCnt === -1 || insertion.stackCnt < this.maxStackCnt)
  }

  handleInvalidInsertion(insertion: SegInsertion, entry: SegEntry, hiddenEntries: SegEntry[]) {
    if (this.allowReslicing && insertion.touchingEntry) {
      return this.splitEntry(entry, insertion.touchingEntry, hiddenEntries)
    } else {
      hiddenEntries.push(entry)
      return 0
    }
  }

  splitEntry(entry: SegEntry, barrier: SegEntry, hiddenEntries: SegEntry[], forceSplit?: boolean): number {
    let partCnt = 0
    let splitHiddenEntries: SegEntry[] = []

    if (entry.spanStart < barrier.spanStart) {
      partCnt += this.insertEntry({
        ...entry,
        spanStart: entry.spanStart,
        spanEnd: barrier.spanStart
      }, splitHiddenEntries)
    }

    if (barrier.spanEnd < entry.spanEnd) {
      partCnt += this.insertEntry({
        ...entry,
        spanStart: barrier.spanEnd,
        spanEnd: entry.spanEnd,
      }, splitHiddenEntries)
    }

    if (partCnt || forceSplit) {
      hiddenEntries.push({
        ...entry,
        spanStart: barrier.spanStart,
        spanEnd: barrier.spanEnd
      }, ...splitHiddenEntries)
      return partCnt

    } else {
      hiddenEntries.push(entry)
      return 0
    }
  }

  insertEntryAt(entry: SegEntry, insertion: SegInsertion): void {
    let { nextLevel } = insertion

    // create a new level
    if (!nextLevel || this.levelCoords[nextLevel - 1] < insertion.levelCoord) {
      insertAt(this.levelCoords, nextLevel, insertion.levelCoord)
      insertAt(this.entriesByLevel, nextLevel, [entry])
    // insert into existing level
    } else {
      insertAt(this.entriesByLevel[nextLevel - 1], insertion.lateralEnd, entry)
    }

    this.stackCnts[hashEntry(entry)] = insertion.stackCnt
  }

  findInsertion(newEntry: SegEntry): SegInsertion {
    let { levelCoords, entriesByLevel, stackCnts } = this
    let levelCnt = levelCoords.length
    let level = 0 // running value while iterating all segs
    let levelCoord // "
    let lateralStart = 0 // "
    let lateralEnd = 0 // "
    let resCoord = 0 // the levelCoord for newSeg
    let touchingEntry: SegEntry = null

    while (
      level < levelCnt && // within bounds
      (levelCoord = levelCoords[level]) < resCoord + newEntry.thickness // level's top collides with newEntry's current bottom
    ) {
      let entries = entriesByLevel[level]
      let entry: SegEntry
      let searchRes = binarySearch(entries, newEntry.spanStart, getEntrySpanEnd)
      lateralStart = searchRes[0] + searchRes[1] // if exact match (which doesn't collide), go to next one
      lateralEnd = lateralStart

      while ( // loop through entries that horizontally intersect
        (entry = entries[lateralEnd]) && // but not past the whole entry list
        entry.spanStart < newEntry.spanEnd
      ) {
        if ( // vertically intersects?
          resCoord < levelCoord + entry.thickness &&
          resCoord + newEntry.thickness > levelCoord
        ) {
          touchingEntry = entry
          resCoord = levelCoord + entry.thickness // move to bottom of colliding entry
        }
        lateralEnd++
      }

      level++
    }

    return {
      levelCoord: resCoord,
      nextLevel: level,
      lateralStart,
      lateralEnd,
      touchingEntry,
      stackCnt: touchingEntry ? stackCnts[hashEntry(touchingEntry)] + 1 : 0
    }
  }

  // sorted by levelCoord (lowest to highest)
  toRects(): SegRect[] {
    let { entriesByLevel, levelCoords } = this
    let levelCnt = entriesByLevel.length
    let rects: SegRect[] = []
    let partIndexHash: { [segId: string]: number } = {}

    for (let level = 0; level < levelCnt; level++) {
      let entries = entriesByLevel[level]
      let levelCoord = levelCoords[level]

      for (let entry of entries) {
        let segIndex = entry.segInput.index
        let partIndex = (partIndexHash[segIndex] = (partIndexHash[segIndex] || 0) + 1)

        rects.push({ ...entry, partIndex, levelCoord })
      }
    }

    return rects
  }
}

export function getEntrySpanEnd(entry: SegEntry) {
  return entry.spanEnd
}

export function hashEntry(entry: SegEntry) { // TODO: rename to something about 'key'???
  return entry.segInput.index + ':' + entry.spanStart
}

// general util
// ---------------------------------------------------------------------------------------------------------------------

function insertAt<Item>(arr: Item[], index: number, item: Item) {
  arr.splice(index, 0, item)
}

export function binarySearch<Item>(
  a: Item[],
  searchVal: number,
  getItemVal: (item: Item) => number
): [number, number] { // returns [level, isExactMatch ? 1 : 0]
  let startIndex = 0
  let endIndex = a.length // exclusive

  if (!endIndex || searchVal < getItemVal(a[startIndex])) { // no items OR before first item
    return [0, 0]
  } else if (searchVal > getItemVal(a[endIndex - 1])) { // after last item
    return [endIndex, 0]
  }

  while (startIndex < endIndex) {
    let middleIndex = Math.floor(startIndex + (endIndex - startIndex) / 2)
    let middleVal = getItemVal(a[middleIndex])

    if (searchVal < middleVal) {
      endIndex = middleIndex
    } else if (searchVal > middleVal) {
      startIndex = middleIndex + 1
    } else { // equal!
      return [middleIndex, 1]
    }
  }

  return [startIndex, 0]
}

// testing
// ---------------------------------------------------------------------------------------------------------------------

// document.addEventListener('DOMContentLoaded', function() {
//   let hierarchyInput: { spanStart: number, spanEnd: number, thickness: number }[] = [
//     { spanStart: 0, spanEnd: 3, thickness: 2 },
//     { spanStart: 0, spanEnd: 1, thickness: 1 },
//     { spanStart: 1, spanEnd: 2, thickness: 10 },
//     { spanStart: 2, spanEnd: 3, thickness: 1 },
//     { spanStart: 3, spanEnd: 4, thickness: 10 },
//     { spanStart: 4, spanEnd: 5, thickness: 1 },
//     { spanStart: 0, spanEnd: 5, thickness: 2 },

//     // { spanStart: 0, spanEnd: 1, thickness: 1 },
//     // { spanStart: 1, spanEnd: 2, thickness: 10 },
//     // { spanStart: 2, spanEnd: 3, thickness: 1 },
//     // { spanStart: 0, spanEnd: 1, thickness: 1 },
//     // { spanStart: 2, spanEnd: 4, thickness: 1 },
//     // { spanStart: 0, spanEnd: 3, thickness: 1 },
//     // { spanStart: 3, spanEnd: 4, thickness: 1 },
//     // { spanStart: 3, spanEnd: 4, thickness: 1 },
//     // { spanStart: 2, spanEnd: 3, thickness: 1 },

//     // { spanStart: 0, spanEnd: 1, thickness: 1 },
//     // { spanStart: 0, spanEnd: 1, thickness: 1 },
//     // { spanStart: 0, spanEnd: 1, thickness: 1 },
//     // { spanStart: 0, spanEnd: 4, thickness: 1 },
//     // { spanStart: 3, spanEnd: 4, thickness: 1 },
//     // { spanStart: 3, spanEnd: 4, thickness: 1 }
//   ]
// })

// function logRects(rects: SegRect[]) {
//   console.log('[')
//   for (let rect of rects) {
//     console.log(JSON.stringify({
//       segId: rect.segInput.index + ':' + rect.partId,
//       spanStart: rect.spanStart,
//       spanEnd: rect.spanEnd,
//       levelCoord: rect.levelCoord,
//       thickness: rect.thickness
//     }))
//   }
//   console.log(']')
// }