import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import styles from './CommercialPipeline.module.css'

const EASE = [0.22, 1, 0.36, 1] as const

const STAGES = [
  'INSPECTION SET',
  'INSPECTION COMPLETED',
  'MEETING SCHEDULED',
  'MEETING COMPLETED',
  'NEEDS INFO',
  'PURGATORY',
  'CLOSE',
  'APPROVAL / WORK ORDER',
  'PRODUCTION COMPLETED',
  'DEAD',
] as const

type Stage = typeof STAGES[number]

interface Card {
  id: string
  rep: string
  customer: string
  phone: string
  address: string
  buildingId: string
  followUp: string
  stage: Stage
}

const REPS = ['James R.', 'Sarah T.', 'Mike D.', 'Lisa N.', 'Tom W.', 'Anna K.', 'Brian S.', 'Carol M.']
const CUSTOMERS = ['Acme Corp', 'HighRise LLC', 'Metro Bldg', 'Summit Co', 'Peak Prop', 'Valley Inc', 'Ridge Group', 'Crest LLC', 'Harbor Co', 'Apex Group']
const ADDRESSES = [
  '1142 Commerce Dr, Ste 100', '88 Industrial Pkwy', '2310 W Tower Blvd',
  '500 Gateway Rd', '77 Harbor View', '321 Business Park Ln', '99 Corporate Way',
  '411 Trade Center Dr', '602 Main St', '1800 Summit Ave',
]

function generateCards(): Card[] {
  let n = 0
  return STAGES.flatMap((stage, si) =>
    Array.from({ length: si === 9 ? 3 : 4 + (si % 3) }, (_, i) => ({
      id: String(n++),
      rep: REPS[(si + i) % REPS.length],
      customer: CUSTOMERS[(si * 3 + i) % CUSTOMERS.length],
      phone: `(555) ${String(200 + si * 7 + i).padStart(3, '0')}-${String(4000 + i * 113 + si * 17).padStart(4, '0')}`,
      address: ADDRESSES[(si + i) % ADDRESSES.length],
      buildingId: `BLD-${String(2000 + si * 10 + i).padStart(4, '0')}`,
      followUp: i % 3 === 0 ? 'Aug 10' : '',
      stage,
    }))
  )
}

const INITIAL_CARDS = generateCards()

/* ── Card content ─────────────────────────────────────────── */

function CardContent({ card, overlay = false }: { card: Card; overlay?: boolean }) {
  return (
    <motion.div
      className={`${styles.card} ${overlay ? styles.cardOverlay : ''}`}
      whileHover={overlay ? undefined : { y: -1, transition: { duration: 0.12 } }}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardCustomer}>{card.customer}</span>
        <span className={styles.cardBuildingId}>{card.buildingId}</span>
      </div>
      <div className={styles.cardAddress}>{card.address}</div>
      <div className={styles.cardBottom}>
        <span className={styles.cardRep}>{card.rep}</span>
        {card.followUp && (
          <span className={styles.cardFollowUp}>{card.followUp}</span>
        )}
      </div>
    </motion.div>
  )
}

/* ── Draggable card ───────────────────────────────────────── */

function DraggableCard({ card }: { card: Card }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={styles.cardOuter}
      style={{ opacity: isDragging ? 0 : 1 }}
    >
      <CardContent card={card} />
    </div>
  )
}

/* ── Droppable column ─────────────────────────────────────── */

function DroppableColumn({ stage, cards }: { stage: Stage; cards: Card[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const isDead = stage === 'DEAD'

  return (
    <div className={styles.column}>
      <div className={`${styles.columnHeader} ${isDead ? styles.columnHeaderDead : ''}`}>
        <span className={styles.columnName}>{stage}</span>
        <span className={`${styles.columnCount} ${isDead ? styles.columnCountDead : ''}`}>
          {cards.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`${styles.columnBody} ${isOver ? styles.columnBodyOver : ''}`}
      >
        <AnimatePresence initial={false}>
          {cards.map(card => (
            <motion.div
              key={card.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              <DraggableCard card={card} />
            </motion.div>
          ))}
        </AnimatePresence>

        {cards.length === 0 && (
          <div className={styles.emptyCol} />
        )}
      </div>
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────── */

export default function CommercialPipeline() {
  const [cards, setCards] = useState<Card[]>(INITIAL_CARDS)
  const [activeCard, setActiveCard] = useState<Card | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const byStage = useMemo<Record<Stage, Card[]>>(() => {
    const map = Object.fromEntries(STAGES.map(s => [s, []])) as Record<Stage, Card[]>
    cards.forEach(c => map[c.stage].push(c))
    return map
  }, [cards])

  function onDragStart({ active }: DragStartEvent) {
    setActiveCard(cards.find(c => c.id === active.id) ?? null)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveCard(null)
    if (!over) return
    const targetStage = over.id as Stage
    if (!STAGES.includes(targetStage)) return
    setCards(prev => prev.map(c => c.id === active.id ? { ...c, stage: targetStage } : c))
  }

  return (
    <motion.div
      className={styles.page}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      <div className={styles.topBar}>
        <span className={styles.pageTitle}>COMMERCIAL PIPELINE</span>
        <span className={styles.totalCount}>{cards.length} records</span>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className={styles.board}>
          {STAGES.map(stage => (
            <DroppableColumn key={stage} stage={stage} cards={byStage[stage]} />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.22,1,0.36,1)' }}>
          {activeCard ? <CardContent card={activeCard} overlay /> : null}
        </DragOverlay>
      </DndContext>
    </motion.div>
  )
}
