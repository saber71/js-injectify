import EventEmitter from "eventemitter3"
import type { Class } from "@heraclius/js-tools"
import { Metadata } from "./metadata"
import type { ContainerLabel, ContainerMember, FieldType, LoadOption, MethodParameterTypes } from "./types"

const prefix = "__container-label__"

export function containerLabel<T>(label: string): ContainerLabel<T> {
  return Symbol(prefix + label)
}

export function isContainerLabel<T>(arg: any): arg is ContainerLabel<T> {
  return typeof arg === "symbol" && new RegExp("^" + prefix).test(arg.description!)
}

function getLabel(label: string | ContainerLabel<any>) {
  if (isContainerLabel(label)) return label.description!.replace(prefix, "")
  return label
}

/* 用来管理需要进行依赖注入的实例的容器。这个类专门进行内容的管理 */
export class Container extends EventEmitter<{
  /* 当加载了一个可以依赖注入的类时触发 */
  loadClass: (clazz: Class, member: ContainerMember) => void
}> {
  /* 缓存容器中的内容，名字映射Member对象 */
  protected readonly _memberMap = new Map<string, ContainerMember>()

  /* 父容器。在当前容器中找不到值时，会尝试在父容器中寻找 */
  private _extend?: Container

  /**
   * 设置要继承的父容器。当从容器中找不到值时，会尝试在父容器中寻找
   * 会继承父容器中的可依赖注入对象，并将生成实例时的上下文环境替换成此实例
   * 在取消继承时删除之
   */
  extend(parent?: Container) {
    if (this._extend === parent) return this
    if (this._extend) {
      this._extend.off("loadClass", this._onLoadClass, this)
      Array.from(this._memberMap.values())
        .filter((member) => member.isExtend)
        .forEach((member) => {
          if (member.isExtend) this._memberMap.delete(member.name)
        })
    }
    this._extend = parent
    if (this._extend) {
      this._extend.on("loadClass", this._onLoadClass, this)
      Array.from(this._extend._memberMap.values())
        .filter((member) => member.metadata)
        .forEach(this._extendMember.bind(this))
    }
    return this
  }

  /* 处理父容器触发的loadClass事件 */
  private _onLoadClass(clazz: Class, member: ContainerMember) {
    this._extendMember(member)
    this.emit("loadClass", clazz, member)
  }

  /* 继承父容器中的可依赖注入对象 */
  private _extendMember(member: ContainerMember) {
    if (!this._memberMap.has(member.name)) {
      const isLoadable = this instanceof LoadableContainer
      this._memberMap.set(member.name, {
        ...member,
        getterContext: isLoadable ? this : member.getterContext,
        factoryContext: isLoadable ? this : member.factoryContext,
        isExtend: true
      })
    }
  }

  /* 给定的类实例，以类名为标识符绑定至容器中 */
  bindInstance<T extends object>(instance: T) {
    return this.bindValue(instance.constructor.name, instance)
  }

  /**
   * 给指定的标识符绑定值
   * @param label 标识符
   * @param value 指定的值
   * @throws InvalidValueError 当从容器获取值，如果值不合法时抛出
   * @throws ForbiddenOverrideInjectableError 当要覆盖可依赖注入的对象时抛出
   */
  bindValue<T = any>(label: string | ContainerLabel<T>, value: T) {
    label = getLabel(label)
    if (value === undefined) throw new InvalidValueError("绑定的值不能是undefined")
    let member = this._memberMap.get(label)
    if (!member) member = this._newMember(label)
    if (member.metadata) throw new ForbiddenOverrideInjectableError("不能覆盖可依赖注入的对象" + label)
    member.value = value
    return this
  }

  /**
   * 给指定的标识符绑定一个工厂函数，在每次访问时生成一个新值
   * @throws ForbiddenOverrideInjectableError 当要覆盖可依赖注入的对象时抛出
   */
  bindFactory<T = any>(label: string | ContainerLabel<T>, value: (...args: any[]) => T, context?: any) {
    label = getLabel(label)
    let member = this._memberMap.get(label)
    if (!member) member = this._newMember(label)
    if (member.metadata) throw new ForbiddenOverrideInjectableError("不能覆盖可依赖注入的对象" + label)
    member.factory = value
    member.factoryContext = context
    return this
  }

  /**
   * 给指定的标识符绑定一个getter，只在第一次访问时执行
   * @throws ForbiddenOverrideInjectableError 当要覆盖可依赖注入的对象时抛出
   */
  bindGetter<T = any>(label: string | ContainerLabel<T>, value: () => T, context?: any) {
    label = getLabel(label)
    let member = this._memberMap.get(label)
    if (!member) member = this._newMember(label)
    if (member.metadata) throw new ForbiddenOverrideInjectableError("不能覆盖可依赖注入的对象" + label)
    member.getter = value
    member.getterContext = context
    member.getterValue = undefined
    return this
  }

  /* 解绑指定的标识符 */
  unbind(label: string) {
    this._memberMap.delete(label)
    return this
  }

  /* 解绑所有标识符 */
  unbindAll() {
    this._memberMap.clear()
  }

  /* 释放资源 */
  dispose() {
    this.unbindAll()
    this.extend(undefined)
  }

  hasLabel(label: string): boolean {
    return this._memberMap.has(label) || !!this._extend?.hasLabel(label)
  }

  /**
   * 获取指定标识符的值
   * @param label 要获取值的标识符
   * @param args 生成值所需的参数
   * @throws InvalidValueError 当从容器获取值，如果值不合法时抛出
   * @throws NotExistLabelError 当从容器访问一个不存在的标识符时抛出
   */
  getValue<T>(label: string | Class<T> | ContainerLabel<T>, ...args: any[]): T {
    if (typeof label === "symbol" || isContainerLabel(label)) label = label.description!.replace(prefix, "")
    else if (typeof label !== "string") label = label.name
    const member = this._memberMap.get(label)
    if (!member) {
      if (this._extend) return this._extend.getValue(label, ...args)
      throw new NotExistLabelError(`容器内不存在名为${label}的标识符`)
    }
    let value = member.value
    if (value === undefined) {
      if (member.factory) value = member.factory.call(member.factoryContext, ...args)
      else {
        value = member.getterValue
        if (value === undefined && member.getter) {
          value = member.getterValue = member.getter.call(member.getterContext)
          member.getter = undefined
        }
      }
    }
    if (value === undefined) throw new InvalidValueError("从容器获取的值不能是undefined")
    return value
  }

  /**
   * 调用方法，其入参必须支持依赖注入
   * @throws MethodNotDecoratedInjectError 试图调用一个未装饰Inject的方法时抛出
   */
  async call<T extends object>(instance: T, methodName: keyof T) {
    const metadata = Metadata.getOrCreate(instance.constructor)
    if (!(methodName in metadata.methodNameMapParameterTypes))
      throw new MethodNotDecoratedInjectError((methodName as any) + "方法未装饰Inject")
    const methodParameter = (metadata.methodNameMapParameterTypes as any)[methodName] as MethodParameterTypes
    const args = this._getMethodParameters(methodParameter)
    for (let cb of methodParameter.beforeCallMethods) {
      await cb?.(this, metadata, args)
    }
    try {
      let returnValue = await (instance as any)[methodName](...args)
      for (let cb of methodParameter.afterCallMethods) {
        returnValue = await cb?.(this, metadata, returnValue, args)
      }
      return returnValue
    } catch (e) {
      for (let cb of methodParameter.afterCallMethods) {
        await cb?.(this, metadata, undefined, args, e as Error)
      }
      throw e
    }
  }

  /**
   * 调用方法，其入参必须支持依赖注入
   * @throws MethodNotDecoratedInjectError 试图调用一个未装饰Inject的方法时抛出
   */
  callSync<T extends object>(instance: T, methodName: keyof T) {
    const metadata = Metadata.getOrCreate(instance.constructor)
    if (!(methodName in metadata.methodNameMapParameterTypes))
      throw new MethodNotDecoratedInjectError((methodName as any) + "方法未装饰Inject")
    const methodParameter = (metadata.methodNameMapParameterTypes as any)[methodName] as MethodParameterTypes
    const args = this._getMethodParameters(methodParameter)
    for (let cb of methodParameter.beforeCallMethods) {
      cb?.(this, metadata, args)
    }
    try {
      let returnValue = (instance as any)[methodName](...args)
      for (let cb of methodParameter.afterCallMethods) {
        returnValue = cb?.(this, metadata, returnValue, args)
      }
      return returnValue
    } catch (e) {
      for (let cb of methodParameter.afterCallMethods) {
        cb?.(this, metadata, undefined, args, e as Error)
      }
      throw e
    }
  }

  /* 获取方法的入参 */
  protected _getMethodParameters(parameters?: MethodParameterTypes) {
    if (!parameters) return []
    return parameters.types.map((type, index) => parameters.getters[index]?.(this) ?? this.getValue(type))
  }

  /* 生成并缓存一个新Member对象 */
  protected _newMember(name: string, metadata?: Metadata): ContainerMember {
    const member: ContainerMember = {
      name,
      metadata
    }
    this._memberMap.set(name, member)
    return member
  }
}

/**
 * 负责实现依赖注入的核心功能，包括得到依赖关系、生成实例、向实例注入依赖
 * @throws DependencyCycleError 当依赖循环时抛出
 */
export class LoadableContainer extends Container {
  /* 标识是否调用过load方法 */
  private _loaded = false

  /**
   * 加载所有已被装饰器Injectable装饰的类且所属于指定的模块
   * @throws ContainerRepeatLoadError 当重复调用Container.load方法时抛出
   */
  load(option: LoadOption = {}) {
    if (this._loaded) throw new ContainerRepeatLoadError("LoadableContainer.load方法已被调用过，不能重复调用")
    this._loaded = true
    const metadataArray = Array.from(Metadata.getAllMetadata())
    this.loadFromMetadata(metadataArray, option)
  }

  /* 从元数据中加载内容进容器中 */
  loadFromMetadata(metadataArray: Metadata[], option: LoadOption = {}) {
    const { overrideParent = false, moduleName } = option
    metadataArray = metadataArray.filter(
      (metadata) => !moduleName || !metadata.moduleName || metadata.moduleName === moduleName
    )
    for (let metadata of metadataArray) {
      this._newMember(metadata.clazz.name, metadata)
    }
    if (overrideParent) {
      for (let item of metadataArray) {
        if (item.overrideParent === false) continue
        const member = this._memberMap.get(item.clazz.name)!
        /* 如果Member已被覆盖就跳过。可能是因为metadata顺序的原因，子类顺序先于父类 */
        if (member.name !== item.clazz.name) continue
        for (let parentClassName of item.parentClassNames) {
          this._memberMap.set(parentClassName, member)
        }
      }
    }
    const createImmediately: ContainerMember[] = []
    const creating = new Set<string>()
    for (let member of this._memberMap.values()) {
      const { metadata } = member
      if (metadata) {
        const { clazz, fieldTypes } = metadata
        const generator = function (this: LoadableContainer) {
          if (creating.has(member.name))
            throw new DependencyCycleError("依赖循环：" + Array.from(creating).join("->") + member.name)
          creating.add(member.name)
          const instance = new clazz(...this._getMethodParameters(metadata.getMethodParameterTypes()))
          for (let propName in fieldTypes) {
            instance[propName] = this._getFieldValue(fieldTypes[propName])
          }
          creating.delete(member.name)
          metadata.onCreate?.(instance)
          return instance
        }
        if (metadata.createImmediately) createImmediately.push(member)
        if (metadata.singleton) {
          member.getter = generator
          member.getterContext = this
        } else {
          member.factory = generator
          member.factoryContext = this
        }
        this.emit("loadClass", clazz, member)
      }
    }
    for (let member of createImmediately) {
      this.getValue(member.name)
    }
  }

  /* 将提供的类绑定进容器内 */
  loadFromClass(clazz: Class[], option: LoadOption = {}) {
    this.loadFromMetadata(
      clazz.map((c) => Metadata.getOrCreate(c)),
      option
    )
  }

  /* 获取字段的值 */
  private _getFieldValue(fieldType: FieldType) {
    if (!fieldType.getter && !fieldType.type) throw new Error("无法通过元数据获取字段类型，必须指定类型")
    return fieldType.getter?.(this) ?? this.getValue(fieldType.type!)
  }
}

/* 当重复调用Container.load方法时抛出 */
export class ContainerRepeatLoadError extends Error {}

/* 当依赖循环时抛出 */
export class DependencyCycleError extends Error {}

/* 当从容器获取值，如果值不合法时抛出 */
export class InvalidValueError extends Error {}

/* 当从容器访问一个不存在的标识符时抛出 */
export class NotExistLabelError extends Error {}

/* 试图调用一个未装饰Inject的方法时抛出 */
export class MethodNotDecoratedInjectError extends Error {}

/* 当要覆盖可依赖注入的对象时抛出 */
export class ForbiddenOverrideInjectableError extends Error {}
