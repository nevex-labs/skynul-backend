import { Layer } from 'effect';
import { AllowanceServiceLive } from '../services/allowances/layer';
import { AuthServiceLive } from '../services/auth';
import { BrowserSnapshotServiceLive } from '../services/browser/layer';
import { ChannelServiceLive } from '../services/channels/layer';
import { CryptoLive } from '../services/crypto';
import { DatabaseLive } from '../services/database';
import { EvalFeedbackServiceLive } from '../services/eval-feedback/layer';
import { PaperPortfolioServiceLive } from '../services/paper-portfolio/layer';
import { ProjectServiceLive } from '../services/projects/layer';
import { ProviderSecretsServiceLive } from '../services/provider-secrets';
import { RiskGuardServiceLive } from '../services/risk-guard/layer';
import { SchedulesServiceLive } from '../services/schedules';
import { SecretServiceLive } from '../services/secrets';
import { SessionServiceLive } from '../services/sessions/layer';
import { SettingsServiceLive } from '../services/settings/layer';
import { SkillServiceLive } from '../services/skills/layer';
import { SmartWalletServiceLive } from '../services/smart-wallet/layer';
import { SwapServiceLive } from '../services/swap/layer';
import { TaskMemoryServiceLive } from '../services/task-memory/layer';
import { TasksServiceLive } from '../services/tasks';
import { WalletServiceLive } from '../services/wallets';

/**
 * Layer base: Servicios de infraestructura sin dependencias
 */
const BaseLayer = Layer.merge(DatabaseLive, CryptoLive);

/**
 * Layer de servicios de dominio: Dependen de BaseLayer
 */
const DomainServicesLayer = Layer.merge(SecretServiceLive, ProjectServiceLive).pipe(Layer.provide(BaseLayer));

const ProviderSecretsLayer = ProviderSecretsServiceLive.pipe(Layer.provide(BaseLayer));

const SessionLayer = SessionServiceLive.pipe(Layer.provide(BaseLayer));

const SettingsLayer = SettingsServiceLive.pipe(Layer.provide(BaseLayer));

const SchedulesLayer = SchedulesServiceLive.pipe(Layer.provide(BaseLayer));

const TasksLayer = TasksServiceLive.pipe(Layer.provide(BaseLayer));

const OtherServicesLayer = Layer.merge(SkillServiceLive, BrowserSnapshotServiceLive).pipe(Layer.provide(BaseLayer));

const ChannelLayer = ChannelServiceLive.pipe(Layer.provide(BaseLayer));

const WalletLayer = WalletServiceLive.pipe(Layer.provide(BaseLayer));

const AuthLayer = AuthServiceLive.pipe(Layer.provide(BaseLayer));

const PaperPortfolioLayer = PaperPortfolioServiceLive.pipe(Layer.provide(BaseLayer));

const RiskGuardLayer = RiskGuardServiceLive.pipe(Layer.provide(BaseLayer));

const TaskMemoryLayer = TaskMemoryServiceLive.pipe(Layer.provide(BaseLayer));

const EvalFeedbackLayer = EvalFeedbackServiceLive.pipe(Layer.provide(BaseLayer));

const AllowanceLayer = AllowanceServiceLive.pipe(Layer.provide(BaseLayer));

const SmartWalletLayer = SmartWalletServiceLive.pipe(Layer.provide(BaseLayer));

const SwapLayer = SwapServiceLive.pipe(
  Layer.provide(Layer.merge(AllowanceLayer, Layer.merge(SmartWalletLayer, BaseLayer)))
);

/**
 * Layer completo de la aplicación
 *
 * Uso en tests:
 *   const TestLayer = Layer.provide(AppLayer, MockDatabase)
 */
export const AppLayer = Layer.merge(
  DomainServicesLayer,
  Layer.merge(
    ProviderSecretsLayer,
    Layer.merge(
      SessionLayer,
      Layer.merge(
        SettingsLayer,
        Layer.merge(
          SchedulesLayer,
          Layer.merge(
            TasksLayer,
            Layer.merge(
              OtherServicesLayer,
              Layer.merge(
                ChannelLayer,
                Layer.merge(
                  AuthLayer,
                  Layer.merge(
                    WalletLayer,
                    Layer.merge(
                      PaperPortfolioLayer,
                      Layer.merge(
                        RiskGuardLayer,
                        Layer.merge(
                          TaskMemoryLayer,
                          Layer.merge(
                            EvalFeedbackLayer,
                            Layer.merge(AllowanceLayer, Layer.merge(SmartWalletLayer, SwapLayer))
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  )
);

/**
 * Layer para testing (con mocks)
 */
export const TestLayer = AppLayer; // TODO: Crear mocks específicos para tests
