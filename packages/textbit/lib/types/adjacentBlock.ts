/** The block caret: beside a block, entered from before or after it */
export interface AdjacentBlockState {
  blockId: string
  direction: 'before' | 'after' // 'before' = cursor arrived from preceding block, 'after' = from following block
}
