import { useContext } from 'react'
import { CommentsContext, type CommentsValue } from '../contexts/CommentsContext'

/**
 * The comments of the editor's text, each thread with where it is now, and
 * writing them: to build a comments panel of your own. Needs a store on
 * `Textbit.Root` as `comments`.
 */
export const useComments = (): CommentsValue => useContext(CommentsContext)
