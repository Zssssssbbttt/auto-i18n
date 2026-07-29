import i18n from './index'
import zhCN from './zh-CN.json'

function findKeyByChinese(chineseText: string): string | null {
  function findKey(obj: any, prefix: string = ''): string | null {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key]
        const fullKey = prefix ? `${prefix}.${key}` : key

        if (value === chineseText) {
          return fullKey
        }

        if (typeof value === 'object' && value !== null) {
          const result = findKey(value, fullKey)
          if (result) return result
        }
      }
    }
    return null
  }

  return findKey(zhCN)
}

/**
 * 单条翻译：通过中文查找语言包中的 key 并翻译
 * 模板中使用：{{ translateText(item.name) }}
 */
export function translateText(chineseText: string): string {
  if (!chineseText) return chineseText

  const locale = i18n.global.locale.value as string
  if (locale === 'zh-CN') return chineseText

  const key = findKeyByChinese(chineseText)
  if (key) {
    const translated = i18n.global.t(key)
    const translatedText = translated !== key ? translated : chineseText
    console.log(
      chineseText +
        '对应的翻译key为：' +
        key +
        '，翻译结果为：' +
        translatedText
    )
    return translatedText
  }

  console.log(chineseText + '未找到对应的翻译key，请检查语言包')

  return chineseText
}

/**
 * 批量翻译：遍历数组，翻译每个对象指定 key 的值
 * 脚本中使用：translateArray(this.viewBtns, 'name')
 */
export function translateArray<T extends Record<string, any>>(
  arr: T[],
  keyName: string
): T[] {
  if (!arr || !arr.length) return arr

  const locale = i18n.global.locale.value as string
  if (locale === 'zh-CN') return arr

  return arr.map((item) => {
    const value = item[keyName]
    if (typeof value === 'string') {
      const translated = translateText(value)
      if (translated !== value) {
        return { ...item, [keyName]: translated }
      }
    }
    return item
  })
}
