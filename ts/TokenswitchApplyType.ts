import { FrontModel, HttpBindNormal, RequestDataBaseType } from '@vnet/types'
import type { IHttpBindNormal } from '@vnet/types'

// TokenSwitch 测试申请表单
export class TokenswitchApplyMainInfo extends FrontModel {
  // === 表单信息 from_接口 ===
  @HttpBindNormal() testId = '' // 	流程号
  @HttpBindNormal() promoterId = '' // 	发起人ID
  @HttpBindNormal() promoterIdNew = '' // 	发起人ID 新工号
  @HttpBindNormal() promoterName = '' // 	发起人姓名
  @HttpBindNormal() promoterDep = '' // 发起人部门 code
  @HttpBindNormal() promoterDepName = '' // 发起人部门名称
  @HttpBindNormal() createDate = '' // 	发起日期
  @HttpBindNormal() applyEmpCode = '' // 	申请人编号
  @HttpBindNormal() applyEmpCodeNew = '' // 申请人 新工号
  @HttpBindNormal() applyEmpName = '' // 	申请人
  @HttpBindNormal() applyEmpPhoneNo = '' // 	申请人电话
  @HttpBindNormal() applyDepCode = '' // 	申请部门编号
  @HttpBindNormal() applyDepName = '' // 	申请部门
  @HttpBindNormal() testSite = '' // 	测试站点
  @HttpBindNormal() testSiteName = '' // 	测试站点name
  @HttpBindNormal() title = '' // 	标题
  @HttpBindNormal() potentialCustomerCode = '' // 	潜在客户编号
  @HttpBindNormal() potentialCustomerName = '' // 	潜在客户名称
  @HttpBindNormal() customerCode = '' // 	商务客户编号
  @HttpBindNormal() customerName = '' // 	商务客户名称
  @HttpBindNormal() isSaleBearCost = '' // 	是否销售侧承担成本
  @HttpBindNormal() clientContact = '' // 	客户联系人
  @HttpBindNormal() clientContactNumber = '' // 	客户联系电话
  @HttpBindNormal() clientContactEmail = '' // 	客户联系邮箱
  @HttpBindNormal() clientType = '' // 	客户类型
  @HttpBindNormal() clientTypeName = '' // 	客户类型name
  @HttpBindNormal() clientBusinessType = '' // 	客户所属的业务类型
  @HttpBindNormal() clientBusinessTypeName = '' // 	客户所属的业务类型name
  @HttpBindNormal() aiAppMaturity = '' // 	客户当前的 AI 应用成熟度
  @HttpBindNormal() aiAppMaturityName = '' // 	客户当前的 AI 应用成熟度name
  @HttpBindNormal() haveAiExperience = '' // 	客户当前是否有同类AIToken平台使用经验
  @HttpBindNormal() haveAiExperienceName = '' // 	客户当前是否有同类AIToken平台使用经验name
  @HttpBindNormal() deploymentArchitecture = '' // 	客户倾向的部署架构
  @HttpBindNormal() deploymentArchitectureName = '' // 	客户倾向的部署架构name
  @HttpBindNormal() publicLargeModel = '' // 	客户目前主要调用的公有大模型(多选)
  @HttpBindNormal() publicLargeModelName = '' // 	客户目前主要调用的公有大模型name(多选)
  @HttpBindNormal() monthlyConsumptionAmount = '' // 	客户目前的Token月消耗金额(万元/月)
  @HttpBindNormal() complianceRedLine = '' // 	客户是否有核心数据[绝对不出内网不出域]的合规红线
  @HttpBindNormal() complianceRedLineName = '' // 	客户是否有核心数据[绝对不出内网不出域]的合规红线name
  @HttpBindNormal() aiScenario = '' // 	客户期望落地的具体AI场景(多选)
  @HttpBindNormal() aiScenarioName = '' // 	客户期望落地的具体AI场景name(多选)
  @HttpBindNormal() expectedStartDate = '' // 	期望测试开始日期
  @HttpBindNormal() expectedEndDate = '' // 	预计测试结束日期
  @HttpBindNormal() testStartDate = '' // 	实际测试开始时间
  @HttpBindNormal() testEndDate = '' // 	实际测试结束时间
  @HttpBindNormal() testAmount = '' // 	申请测试金额
  @HttpBindNormal() ccEmp = '' // 	流程抄送人员(多选)
  @HttpBindNormal() ccEmpNew = '' // 	流程抄送人员(多选)
  @HttpBindNormal() ccEmpName = '' // 	流程抄送人员name(多选)
  @HttpBindNormal() testAccount = '' // 	测试账号
  @HttpBindNormal() operationConfirmer = '' // 	运营确认人员(多选)
  @HttpBindNormal() operationConfirmerNew = '' // 	运营确认人员(多选)
  @HttpBindNormal() operationConfirmerName = '' // 	运营确认人员name(多选)
  @HttpBindNormal() remark = '' // 	备注
  @HttpBindNormal() fixProcessinstanceId = '' // 	流程实例号
  @HttpBindNormal() fixProcessstate = '' // 	流程状态
  @HttpBindNormal() flowInstanceStatus = '' // 	流程-流程状态
  @HttpBindNormal() currentStepNode = '' // 	流程-当前步骤
  @HttpBindNormal() reachTime = '' // 	流程-到达时间
  @HttpBindNormal() handlerNos = '' // 	流程-处理人编号集
  @HttpBindNormal() handlerDis = '' // 	流程-处理人显示集
  @HttpBindNormal() businessUnitNo = '' // 	业务单元编号-用于配置代理的备用数据

  constructor() {
    super()
  }

  getNextAssigneeRequestBody(): RequestDataBaseType {
    const body = new RequestDataBaseType()
    const metadataKeys: Array<string> = Reflect.getMetadataKeys(this)
    metadataKeys.forEach((metadataKey: string) => {
      const metadataValue: IHttpBindNormal = Reflect.getMetadata(metadataKey, this)
      if (metadataValue.serverPropertyTypeName === 'normal') {
        const value: any = Reflect.get(this, metadataValue.propertyName)
        Reflect.set(body, metadataValue.serverPropertyPath, value)
      }
    })
    return body
  }
}

// 表单验证规则
export const TokenswitchApplyRules = {
  // 申请人信息
  applyEmpPhoneNo: {
    required: true,
    message: '请输入申请人电话',
    trigger: ['blur', 'change'],
  },
  applyDepCode: {
    required: true,
    message: '请选择申请人部门',
    trigger: ['change'],
  },
  // 申请基本信息
  testSite: {
    required: true,
    message: '请选择测试站点',
    trigger: ['blur', 'change'],
  },
  title: {
    required: true,
    message: '请输入标题',
    trigger: ['blur', 'change'],
  },
  // 客户信息
  customerCode: {
    required: true,
    message: '请选择商务客户',
    trigger: ['blur', 'change'],
  },
  potentialCustomerCode: {
    required: true,
    message: '请选择潜在客户',
    trigger: ['blur', 'change'],
  },
  clientType: {
    required: true,
    message: '请选择客户类型',
    trigger: ['blur', 'change'],
  },
  isSaleBearCost: {
    required: true,
    message: '请选择是否销售侧承担成本',
    trigger: ['blur', 'change'],
  },
  clientContact: {
    required: true,
    message: '请输入客户联系人',
    trigger: ['blur', 'change'],
  },
  clientContactNumber: {
    required: true,
    message: '请输入客户联系电话',
    trigger: ['blur', 'change'],
  },
  clientContactEmail: {
    required: true,
    message: '请输入客户联系邮箱',
    trigger: ['blur', 'change'],
  },
  // 客户字典
  clientBusinessType: {
    required: true,
    message: '请选择客户所属的业务类型',
    trigger: ['blur', 'change'],
  },
  aiAppMaturity: {
    required: true,
    message: '请选择客户当前的AI应用成熟度',
    trigger: ['blur', 'change'],
  },
  haveAiExperience: {
    required: true,
    message: '请选择同类AIToken平台使用经验',
    trigger: ['blur', 'change'],
  },
  deploymentArchitecture: {
    required: true,
    message: '请选择客户倾向的部署架构',
    trigger: ['blur', 'change'],
  },
  publicLargeModel: {
    required: true,
    message: '请选择客户调用的公有大模型',
    trigger: ['blur', 'change'],
  },
  monthlyConsumptionAmount: {
    required: true,
    message: '请输入Token月消耗金额(万元/月)',
    trigger: ['blur', 'change'],
  },
  complianceRedLine: {
    required: true,
    message: '请选择合规红线',
    trigger: ['blur', 'change'],
  },
  aiScenario: {
    required: true,
    message: '请选择客户期望落地的AI场景',
    trigger: ['blur', 'change'],
  },
  // 日期
  expectedStartDate: {
    required: true,
    message: '请选择期望测试开始日期',
    trigger: ['blur', 'change'],
  },
  testStartDate: {
    required: true,
    message: '请选择实际测试开始日期',
    trigger: ['blur', 'change'],
  },
  testEndDate: {
    required: true,
    message: '请选择实际测试结束日期',
    trigger: ['blur', 'change'],
  },
  // 金额
  testAmount: {
    required: true,
    message: '请输入/选择测试金额',
    trigger: ['blur', 'change'],
  },
  testAccount: {
    required: true,
    message: '请输入测试账号',
    trigger: ['blur', 'change'],
  },
}
