import i18n from './index'

/**
 * i18n composable
 * 在 <script setup> 中使用: const { t } = useI18n()
 * 模板中可直接使用 {{ t('key') }}
 */
export function useI18n() {
  return { t: i18n.global.t }
}
