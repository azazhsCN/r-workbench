/**
 * 智能方法推荐面板（v0.3.5 / T73）
 *
 * ── 为什么是组件而不是页面 ──
 *
 * DEVELOPMENT_PLAN §5.5.5 明确要求：**不要做成独立页面**。
 * 用户的目标是"开始分析"，不是"看推荐"。所以这个面板内嵌在
 * 向导页顶部与数据页里，点推荐项**直接跳转并预选**，不产生额外的导航层级。
 *
 * ── 跳转闭环（本功能的价值所在）──
 *
 * 点某一项 → `onApply(methodId, variables, roles, texts)` → 调用方转成
 * `requestSelection()` 写入 DataContext → 向导页消费 → 自动选中方法、
 * 预填变量与角色、直接进入 configure 步骤。
 *
 * 只给文字不跳转的实现是**没有价值**的：用户还是得自己去 24 张卡片里找那个方法，
 * 再手工复选变量——而"选哪个变量当 M"正是推荐想替他省掉的那一步。
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../contexts/DataContext'
import { useAI } from '../contexts/AIContext'
import { useR } from '../contexts/RContext'
import { recommendMethods, type Recommendation, type RecommendationResult } from '../services/recommendService'
import type { DatasetProfile } from '../services/columnProfile'

export interface MethodRecommendProps {
  /**
   * 应用某条推荐。**必须**实现真正的跳转 + 预选（T73 验收硬指标）。
   * 参数是已解析好的预选内容，调用方不需要再解析变量。
   */
  onApply: (selection: {
    methodId: string
    variables: string[]
    roles?: Record<string, string>
    texts?: Record<string, string>
    groupVar?: string
  }) => void
  /** 面板形态：向导页用 `inline`（紧凑），数据页用 `card`（带周边距） */
  variant?: 'inline' | 'card'
  /** 数据页导入后自动展开 */
  defaultOpen?: boolean
  /** 关闭面板 */
  onDismiss?: () => void
}

export default function MethodRecommend({
  onApply,
  variant = 'inline',
  defaultOpen = false,
  onDismiss
}: MethodRecommendProps) {
  const { t } = useTranslation()
  const { profile, dataset } = useData()
  const { service: ai, isConfigured } = useAI()
  const { status: rStatus } = useR()

  const [open, setOpen] = useState(defaultOpen)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RecommendationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showExcluded, setShowExcluded] = useState(false)

  const run = async (p: DatasetProfile) => {
    setLoading(true)
    setError(null)
    try {
      // AI 只在三个条件同时满足时启用：
      //   1. 用户配置了 API Key
      //   2. R 环境存在（推荐不依赖 R，但没 R 时分析也跑不了，先提示更重要的事）
      //   3. 画像存在
      // 任一不满足就走规则层降级——**这不是错误态**，是设计好的可用状态。
      const canUseAi = isConfigured && rStatus.found
      const res = await recommendMethods(p, t, { ai: canUseAi ? ai.chat.bind(ai) : undefined })
      setResult(res)
    } catch (e) {
      // recommendMethods 内部已兜住所有已知失败；能走到这里说明是意料外的错误。
      // 仍然不崩界面：显示提示并保留"重试"。
      setError((e as Error).message || t('recommend.degraded.aiError'))
    } finally {
      setLoading(false)
    }
  }

  const handleOpen = () => {
    setOpen(true)
    if (!profile) return
    if (result) return // 已算过，复用（数据不变时结论不变）
    void run(profile)
  }

  const handleRetry = () => {
    if (!profile) return
    setResult(null)
    void run(profile)
  }

  /* ── 入口按钮（未展开时）── */
  if (!open) {
    return (
      <div style={{ marginBottom: variant === 'card' ? 20 : 16 }}>
        <button className="btn btn-secondary btn-sm" onClick={handleOpen} disabled={!profile}>
          {t('recommend.button')}
        </button>
        {variant === 'card' && (
          <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-tertiary)' }}>
            {t('recommend.subtitle')}
          </span>
        )}
      </div>
    )
  }

  /* ── 展开态 ── */
  return (
    <div
      style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        marginBottom: 20
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>✨ {t('recommend.title')}</div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setOpen(false)
            onDismiss?.()
          }}
        >
          {t('common.close')}
        </button>
      </div>

      {/* 数据结构摘要：推荐依据要可见，否则用户无从判断推荐是否靠谱 */}
      {profile && <ProfileSummary profile={profile} />}

      {loading && (
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)' }}>
          <div style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginBottom: 8 }}>
            ⏳
          </div>
          <div>{t('recommend.analyzing')}</div>
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'var(--error-bg)',
            border: '1px solid var(--error)',
            borderRadius: 'var(--radius-md)',
            padding: 12,
            fontSize: 13,
            color: 'var(--error)'
          }}
        >
          ❌ {error}{' '}
          <button className="btn btn-ghost btn-sm" onClick={handleRetry}>
            {t('recommend.analyzing')}
          </button>
        </div>
      )}

      {/* 无数据 / 无候选 */}
      {!loading && !error && !dataset && (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('recommend.empty')}</div>
      )}
      {!loading && !error && result && result.recommendations.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{t('recommend.noCandidates')}</div>
      )}

      {/* 降级提示：必须明确告诉用户"这些没有按研究问题排序" */}
      {!loading && result?.degradedReason && (
        <div
          style={{
            background: 'var(--warning-bg)',
            border: '1px solid var(--warning)',
            borderRadius: 'var(--radius-md)',
            padding: 10,
            marginBottom: 12,
            fontSize: 12,
            lineHeight: 1.6
          }}
        >
          {t(`recommend.degraded.${result.degradedReason}`)}
        </div>
      )}

      {/* 推荐列表 */}
      {!loading && result && result.recommendations.length > 0 && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
            {result.degradedReason ? t('recommend.subtitle') : t('recommend.aiIntro')}
          </div>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {result.recommendations.map((rec, i) => (
              <RecommendationItem
                key={rec.methodId}
                index={i + 1}
                rec={rec}
                onApply={() =>
                  onApply({
                    methodId: rec.methodId,
                    variables: rec.suggestedVariables,
                    roles: rec.suggestedRoles,
                    texts: rec.suggestedTexts,
                    groupVar: undefined
                  })
                }
              />
            ))}
          </ol>
        </>
      )}

      {/* 需补充信息的方法（不是"不适用"，而是需要研究假设） */}
      {!loading && result && result.requiresUserInput.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
            {t('recommend.requiresInput.title')}
          </div>
          <div style={{ marginBottom: 4 }}>
            {result.requiresUserInput
              .map((id) => t(`wizard.method.${id}`, { defaultValue: id }))
              .join('、')}
          </div>
          <div>{t('recommend.requiresInput.hint')}</div>
        </div>
      )}

      {/* 排除原因（可展开）：诚实说明"为什么没推荐某方法"，用户才能信任推荐 */}
      {!loading && result && result.excludedCount > 0 && (
        <div style={{ marginTop: 14 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowExcluded((v) => !v)}
            style={{ fontSize: 12 }}
          >
            {t('recommend.excluded', { count: result.excludedCount })} ·{' '}
            {showExcluded ? t('recommend.excluded.hide') : t('recommend.excluded.show')}
          </button>
          {showExcluded && (
            <ul
              style={{
                margin: '8px 0 0',
                paddingLeft: 18,
                fontSize: 12,
                color: 'var(--text-tertiary)',
                lineHeight: 1.8
              }}
            >
              {result.excluded
                .filter((a) => a.reasonKey)
                .map((a) => (
                  <li key={a.methodId}>
                    <strong>{t(`wizard.method.${a.methodId}`, { defaultValue: a.methodId })}</strong>
                    {' — '}
                    {t(a.reasonKey, a.params ?? {})}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>
        {t('recommend.apply.hint')}
      </div>
    </div>
  )
}

/** 数据结构摘要：让"推荐依据"可见 */
function ProfileSummary({ profile }: { profile: DatasetProfile }) {
  const { t } = useTranslation()
  const items: string[] = [
    t('recommend.dataSummary.rows', { n: profile.rowCount }),
    t('recommend.dataSummary.numeric', { n: profile.numericColumns.length }),
    t('recommend.dataSummary.categorical', { n: profile.categoricalColumns.length })
  ]
  if (profile.scaleItems.length > 0) {
    items.push(t('recommend.dataSummary.scaleItems', { n: profile.scaleItems.length }))
  }
  return (
    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
      <strong style={{ color: 'var(--text-secondary)' }}>{t('recommend.dataSummary.title')}：</strong>
      {items.join(' · ')}
    </div>
  )
}

/** 单条推荐 */
function RecommendationItem({
  index,
  rec,
  onApply
}: {
  index: number
  rec: Recommendation
  onApply: () => void
}) {
  const { t } = useTranslation()
  return (
    <li style={{ marginBottom: 14, lineHeight: 1.7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14 }}>
          {index}. {rec.name}
        </strong>
        {index === 1 && <span style={{ fontSize: 12, color: 'var(--warning)' }}>⭐</span>}
        <span
          style={{
            fontSize: 11,
            padding: '1px 6px',
            borderRadius: 4,
            background: rec.fromAI ? 'var(--primary-bg)' : 'var(--bg-tertiary)',
            color: rec.fromAI ? 'var(--primary)' : 'var(--text-tertiary)'
          }}
        >
          {rec.fromAI ? t('recommend.fromAI') : t('recommend.fromRules')}
        </span>
      </div>

      {/* "为什么适合这份数据"——AI 生成；降级时没有这一行 */}
      {rec.whyFits && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{rec.whyFits}</div>
      )}

      {/* 方法简介：复用 i18n，不是 AI 写的 */}
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
        {rec.description}
      </div>

      {/* 建议变量：让用户在点之前就知道会被预选哪些列 */}
      {rec.suggestedVariables.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
          {t('recommend.dataSummary.title')}：{rec.suggestedVariables.join('、')}
        </div>
      )}

      <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={onApply}>
        {t('recommend.apply')}
      </button>
    </li>
  )
}
