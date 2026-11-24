import { useEffect, useState } from 'react'
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AiBadge } from './ui.jsx'

const CAT = 'cat:'

function dotClass(ref, { status, current, verifications }) {
  if (ref === current) return 'cur'
  if (verifications?.[ref]?.verdict === 'problem' && verifications[ref].user !== 'ok') return 'bad'
  return status[ref] ?? ''
}

function Row({ ref_, board, ctx, dragging, overlay, ...rest }) {
  const part = board.parts[ref_]
  return (
    <div className={`item ${ref_ === ctx.current ? 'cur' : ''} ${ctx.status[ref_] === 'placed' ? 'placed' : ''} ${dragging ? 'dragging' : ''} ${overlay ? 'drag-overlay' : ''}`} {...rest}>
      <span className={`dot ${dotClass(ref_, ctx)}`} />
      <span className="ref">{ref_}</span>
      <span className="val">{part.value}</span>
      <span className="pkg">{part.size.code}</span>
    </div>
  )
}

function SortableItem({ id, board, ctx, onPick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <Row
      ref_={id}
      board={board}
      ctx={ctx}
      dragging={isDragging}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => onPick?.(id)}
      {...attributes}
      {...listeners}
    />
  )
}

function SortableCategory({ cat, children, aiPlan }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: CAT + cat.id })
  return (
    <div className={`cat ${isDragging ? 'dragging' : ''}`} ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <div className="cat-head" {...attributes} {...listeners}>
        {cat.name} {aiPlan && !cat.appAdded && <AiBadge simulated={aiPlan === 'simulated'} />}
        <span className="count">{cat.refs.length}</span>
      </div>
      {cat.reason && <div className="cat-reason">{cat.reason}</div>}
      {children}
    </div>
  )
}

/**
 * Drag to reorder parts (within and across categories) and whole categories.
 * onChange receives the new plan when a drag ends; a tap on a row calls onPick.
 */
export function BomList({ plan, board, status = {}, current = null, verifications = {}, onChange, onPick }) {
  const [cats, setCats] = useState(plan.categories)
  const [active, setActive] = useState(null)
  useEffect(() => {
    setCats(plan.categories)
  }, [plan])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const ctx = { status, current, verifications }
  const aiPlan = plan.source === 'ai' ? 'ai' : plan.source === 'simulated' ? 'simulated' : null

  const catOf = (list, id) => (String(id).startsWith(CAT) ? list.find((c) => CAT + c.id === id) : list.find((c) => c.refs.includes(id)))

  const onDragOver = ({ active: a, over }) => {
    if (!over || String(a.id).startsWith(CAT)) return
    setCats((list) => {
      const from = catOf(list, a.id)
      const to = catOf(list, over.id)
      if (!from || !to || from === to) return list
      const idx = String(over.id).startsWith(CAT) ? to.refs.length : to.refs.indexOf(over.id)
      return list.map((c) => {
        if (c === from) return { ...c, refs: c.refs.filter((r) => r !== a.id) }
        if (c === to) return { ...c, refs: [...c.refs.slice(0, idx), a.id, ...c.refs.slice(idx)] }
        return c
      })
    })
  }

  const onDragEnd = ({ active: a, over }) => {
    setActive(null)
    let next = cats
    if (over) {
      if (String(a.id).startsWith(CAT)) {
        const from = cats.findIndex((c) => CAT + c.id === a.id)
        const target = catOf(cats, over.id)
        const to = cats.indexOf(target)
        if (from >= 0 && to >= 0 && from !== to) next = arrayMove(cats, from, to)
      } else {
        const c = catOf(cats, a.id)
        const from = c.refs.indexOf(a.id)
        const to = String(over.id).startsWith(CAT) ? c.refs.length - 1 : c.refs.indexOf(over.id)
        if (to >= 0 && from !== to) next = cats.map((x) => (x === c ? { ...x, refs: arrayMove(x.refs, from, to) } : x))
      }
    }
    next = next.filter((c) => c.refs.length)
    setCats(next)
    if (next !== plan.categories) onChange?.({ ...plan, categories: next, reordered: true })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={({ active: a }) => setActive(a.id)} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => (setActive(null), setCats(plan.categories))}>
      <div className="bom">
        <SortableContext items={cats.map((c) => CAT + c.id)} strategy={verticalListSortingStrategy}>
          {cats.map((c) => (
            <SortableCategory key={c.id} cat={c} aiPlan={aiPlan}>
              <SortableContext items={c.refs} strategy={verticalListSortingStrategy}>
                {c.refs.map((r) => (
                  <SortableItem key={r} id={r} board={board} ctx={ctx} onPick={onPick} />
                ))}
              </SortableContext>
            </SortableCategory>
          ))}
        </SortableContext>
      </div>
      <DragOverlay>
        {active && !String(active).startsWith(CAT) && <Row ref_={active} board={board} ctx={ctx} overlay />}
        {active && String(active).startsWith(CAT) && <div className="cat drag-overlay"><div className="cat-head">{cats.find((c) => CAT + c.id === active)?.name}</div></div>}
      </DragOverlay>
    </DndContext>
  )
}
