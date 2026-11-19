# Contributors

This file records who contributed to each Hyperglass release when the commit history alone does not show it. A pull request merged by squash, or a change carried inside another pull request, leaves one author on `main`. The people below wrote, proposed, reported or reviewed the work.

To correct an entry, open a pull request or an issue.

## Hyperglass 3.0.0

This section covers every change between `v2.0.4` and `v3.0.0-rc.2`.

### Project lineage

- [Matt Love](https://github.com/thatmattlove) ([@thatmattlove](https://github.com/thatmattlove)) created Hyperglass and maintained it through 2.0.4.
- [Jason Hall](https://github.com/jdhall75) ([@jdhall75](https://github.com/jdhall75)) maintained the project in 2024 and 2025. Jason reviewed and merged [#284](https://github.com/hyperglass-community/hyperglass/pull/284), [#292](https://github.com/hyperglass-community/hyperglass/pull/292), [#299](https://github.com/hyperglass-community/hyperglass/pull/299), [#304](https://github.com/hyperglass-community/hyperglass/pull/304), [#306](https://github.com/hyperglass-community/hyperglass/pull/306), [#325](https://github.com/hyperglass-community/hyperglass/pull/325), [#327](https://github.com/hyperglass-community/hyperglass/pull/327), [#329](https://github.com/hyperglass-community/hyperglass/pull/329) and [#332](https://github.com/hyperglass-community/hyperglass/pull/332), and wrote 20 commits of build, documentation, lint and changelog work that are part of 3.0.0. Jason also reported [#326](https://github.com/hyperglass-community/hyperglass/issues/326) and [#331](https://github.com/hyperglass-community/hyperglass/issues/331).
- [Wilhelm Schonfeldt](https://github.com/WilhelmZA) ([@WilhelmZA](https://github.com/WilhelmZA)) wrote Ultraglass, the fork that 3.0.0 incorporates. The migration is tracked in [#390](https://github.com/hyperglass-community/hyperglass/issues/390) and landed as [#392](https://github.com/hyperglass-community/hyperglass/pull/392) to [#403](https://github.com/hyperglass-community/hyperglass/pull/403).
- [Jonathan Senecal](https://github.com/jsenecal) ([@jsenecal](https://github.com/jsenecal)) co-maintains the community project.

### Code on `main` under another author's name

These contributors wrote code that is on `main` in a squash commit that names only the person who merged it.

- **Jonathan Senecal** ([@jsenecal](https://github.com/jsenecal)). Six commits from three pull requests were merged inside the release pull request [#420](https://github.com/hyperglass-community/hyperglass/pull/420), squash commit [`795e675c`](https://github.com/hyperglass-community/hyperglass/commit/795e675c):
  - [#357](https://github.com/hyperglass-community/hyperglass/pull/357), automatic worker count that respects CPU affinity and cgroup v1 and v2 quotas, with `HYPERGLASS_WORKERS` as an override. Commits `b4d6fbf7`, `7eaec024` and `932d2013`. Resolves [#356](https://github.com/hyperglass-community/hyperglass/issues/356), which Jonathan also reported.
  - [#410](https://github.com/hyperglass-community/hyperglass/pull/410), tests that run the Netmiko transport against a real OpenSSH server, and the CI job that runs them. Commits `dc4319d2` and `a49268b1`.
  - [#411](https://github.com/hyperglass-community/hyperglass/pull/411), the Renovate configuration. Commit `631cbe31`.
- **Carlos Santos** ([@CarlosSuporteISP](https://github.com/CarlosSuporteISP)). [#340](https://github.com/hyperglass-community/hyperglass/pull/340) added structured BGP output for Huawei and MikroTik in 83 commits between 2025-09-13 and 2025-09-30. [#343](https://github.com/hyperglass-community/hyperglass/pull/343) built on 79 of those commits, and that work continued in Ultraglass. The migration transferred it in [#398](https://github.com/hyperglass-community/hyperglass/pull/398) and [#400](https://github.com/hyperglass-community/hyperglass/pull/400). About 370 lines of [#340](https://github.com/hyperglass-community/hyperglass/pull/340) are unchanged on `main`, in these files:
  - `hyperglass/models/parsing/huawei.py`
  - `hyperglass/models/parsing/mikrotik.py`
  - `hyperglass/plugins/_builtin/bgp_route_huawei.py`
  - `hyperglass/plugins/_builtin/bgp_routestr_huawei.py`
  - `hyperglass/plugins/_builtin/bgp_routestr_mikrotik.py`
  - `hyperglass/plugins/_builtin/mikrotik_garbage_output.py`
  - `hyperglass/defaults/directives/huawei.py`
  - `hyperglass/defaults/directives/mikrotik.py`

  Carlos also reported [#341](https://github.com/hyperglass-community/hyperglass/issues/341).
- **Alexander Tsyganov** ([@ant-atsyganov](https://github.com/ant-atsyganov)). [Ultraglass #17](https://github.com/WilhelmZA/ultraglass/pull/17) resolves shared query types by name when the selected devices use different vendors. The migration transferred it in [#399](https://github.com/hyperglass-community/hyperglass/pull/399). It resolves [#320](https://github.com/hyperglass-community/hyperglass/issues/320).

### Contributions merged with their own commits

These pull requests were merged after 2.0.4 and before the migration. Their commits keep the author's name on `main`.

- [@chriswiggins](https://github.com/chriswiggins): [#304](https://github.com/hyperglass-community/hyperglass/pull/304), FRR structured output for BGP routes.
- [@cooperwinser](https://github.com/cooperwinser): [#306](https://github.com/hyperglass-community/hyperglass/pull/306), integer values in Arista extended communities. Resolves [#305](https://github.com/hyperglass-community/hyperglass/issues/305).
- [@ServerForge](https://github.com/ServerForge): [#284](https://github.com/hyperglass-community/hyperglass/pull/284), VyOS directives.
- [@GrandArcher](https://github.com/GrandArcher): [#292](https://github.com/hyperglass-community/hyperglass/pull/292), MikroTik BGP route command that also selects supernets.
- [@Jimmy01240397](https://github.com/Jimmy01240397): [#299](https://github.com/hyperglass-community/hyperglass/pull/299), directive rules and fields with a `None` value. Resolves [#280](https://github.com/hyperglass-community/hyperglass/issues/280).
- [@jagardaniel](https://github.com/jagardaniel): [#325](https://github.com/hyperglass-community/hyperglass/pull/325), code block padding in the documentation.
- [@JelsonRodrigues](https://github.com/JelsonRodrigues): [#327](https://github.com/hyperglass-community/hyperglass/pull/327), the Huawei BGP route input plugin, a BGP route timeout fix and the plugin validation order. Resolves [#187](https://github.com/hyperglass-community/hyperglass/issues/187) and [#315](https://github.com/hyperglass-community/hyperglass/issues/315).
- [@Computroniks](https://github.com/Computroniks): [#329](https://github.com/hyperglass-community/hyperglass/pull/329), field validation for devices and directives, and the API documentation rendering. Resolves [#311](https://github.com/hyperglass-community/hyperglass/issues/311).
- [@jessiebryan](https://github.com/jessiebryan): [#332](https://github.com/hyperglass-community/hyperglass/pull/332), custom proxy port for SSH proxy tunnels.

### Pull requests that 3.0.0 supersedes

Each pull request below was closed because an equivalent change is on `main`. The author found the problem or proposed the fix first.

- [@bronson-calif](https://github.com/bronson-calif): [#382](https://github.com/hyperglass-community/hyperglass/pull/382), shell quoting of directive targets, and the security report [#383](https://github.com/hyperglass-community/hyperglass/issues/383). Carried by [#392](https://github.com/hyperglass-community/hyperglass/pull/392), [#393](https://github.com/hyperglass-community/hyperglass/pull/393) and [#407](https://github.com/hyperglass-community/hyperglass/pull/407).
- [@ndegwairungu](https://github.com/ndegwairungu): [#378](https://github.com/hyperglass-community/hyperglass/pull/378), the Click constraint for Typer compatibility, carried by [#389](https://github.com/hyperglass-community/hyperglass/pull/389). [#379](https://github.com/hyperglass-community/hyperglass/pull/379), timing-based reads for MikroTik on RouterOS 7, carried by [#396](https://github.com/hyperglass-community/hyperglass/pull/396) and [#400](https://github.com/hyperglass-community/hyperglass/pull/400).
- [@LucaTheHacker](https://github.com/LucaTheHacker): [#297](https://github.com/hyperglass-community/hyperglass/pull/297), publication to GHCR, carried by [#389](https://github.com/hyperglass-community/hyperglass/pull/389) and [#404](https://github.com/hyperglass-community/hyperglass/pull/404). [#298](https://github.com/hyperglass-community/hyperglass/pull/298), Compose, Valkey and Docker layer caching, carried by [#424](https://github.com/hyperglass-community/hyperglass/pull/424) inside [#420](https://github.com/hyperglass-community/hyperglass/pull/420).
- [@pva](https://github.com/pva): [#361](https://github.com/hyperglass-community/hyperglass/pull/361), the `HYPERGLASS_DISABLE_UI` variable name, and [#363](https://github.com/hyperglass-community/hyperglass/pull/363), the pnpm pin for build scripts. Both carried by [#394](https://github.com/hyperglass-community/hyperglass/pull/394). pva also reported [#360](https://github.com/hyperglass-community/hyperglass/issues/360) and [#362](https://github.com/hyperglass-community/hyperglass/issues/362).
- [@mconf248](https://github.com/mconf248): [#302](https://github.com/hyperglass-community/hyperglass/pull/302), the same `HYPERGLASS_DISABLE_UI` correction, proposed in 2024. Carried by [#394](https://github.com/hyperglass-community/hyperglass/pull/394).
- [@sinuscosinustan](https://github.com/sinuscosinustan): [#344](https://github.com/hyperglass-community/hyperglass/pull/344), FRR empty results and missing attributes. Carried by [#400](https://github.com/hyperglass-community/hyperglass/pull/400).
- [@AleksBelytskyi](https://github.com/AleksBelytskyi): [#346](https://github.com/hyperglass-community/hyperglass/pull/346), Huawei structured BGP route output. Carried by [#398](https://github.com/hyperglass-community/hyperglass/pull/398) and [#400](https://github.com/hyperglass-community/hyperglass/pull/400). AleksBelytskyi also reported [#345](https://github.com/hyperglass-community/hyperglass/issues/345).
- [@Rishi556](https://github.com/Rishi556): [#347](https://github.com/hyperglass-community/hyperglass/pull/347), Arista large communities. Carried by [#400](https://github.com/hyperglass-community/hyperglass/pull/400).
- [@tobiaspal](https://github.com/tobiaspal): [#354](https://github.com/hyperglass-community/hyperglass/pull/354), `read_timeout` on Netmiko `send_command`. Carried by [#396](https://github.com/hyperglass-community/hyperglass/pull/396).
- [@ttiot](https://github.com/ttiot): [#281](https://github.com/hyperglass-community/hyperglass/pull/281), the `builtins` key in the device documentation. Carried by [#403](https://github.com/hyperglass-community/hyperglass/pull/403).
- [@szferguson](https://github.com/szferguson): [#260](https://github.com/hyperglass-community/hyperglass/pull/260), an earlier fix for the Arista extended community type. [#306](https://github.com/hyperglass-community/hyperglass/pull/306) resolved the same defect.
- [@M0NsTeRRR](https://github.com/M0NsTeRRR): [#256](https://github.com/hyperglass-community/hyperglass/pull/256), [#276](https://github.com/hyperglass-community/hyperglass/pull/276) and [#279](https://github.com/hyperglass-community/hyperglass/pull/279), earlier proposals for a custom DNS-over-HTTPS server and for the Docker UI build, and [#248](https://github.com/hyperglass-community/hyperglass/pull/248), an earlier workflow that publishes the Docker image. 3.0.0 resolves the related reports [#254](https://github.com/hyperglass-community/hyperglass/issues/254) and [#278](https://github.com/hyperglass-community/hyperglass/issues/278) in a different way.

### Issue reporters

72 people reported the 91 issues that 3.0.0 resolves. Issues that the maintainers opened are not listed.

- [@33Fraise33](https://github.com/33Fraise33): [#293](https://github.com/hyperglass-community/hyperglass/issues/293)
- [@adamgent](https://github.com/adamgent): [#178](https://github.com/hyperglass-community/hyperglass/issues/178)
- [@AleksBelytskyi](https://github.com/AleksBelytskyi): [#345](https://github.com/hyperglass-community/hyperglass/issues/345)
- [@Alex4386](https://github.com/Alex4386): [#186](https://github.com/hyperglass-community/hyperglass/issues/186)
- [@AliMickey](https://github.com/AliMickey): [#280](https://github.com/hyperglass-community/hyperglass/issues/280)
- [@allanfrizzo](https://github.com/allanfrizzo): [#257](https://github.com/hyperglass-community/hyperglass/issues/257), [#259](https://github.com/hyperglass-community/hyperglass/issues/259)
- [@amindomao](https://github.com/amindomao): [#210](https://github.com/hyperglass-community/hyperglass/issues/210)
- [@arraisfilho](https://github.com/arraisfilho): [#187](https://github.com/hyperglass-community/hyperglass/issues/187)
- [@astlaurent](https://github.com/astlaurent): [#273](https://github.com/hyperglass-community/hyperglass/issues/273)
- [@bbs2web](https://github.com/bbs2web): [#191](https://github.com/hyperglass-community/hyperglass/issues/191), [#192](https://github.com/hyperglass-community/hyperglass/issues/192)
- [@BlueWaterCrystal](https://github.com/BlueWaterCrystal): [#287](https://github.com/hyperglass-community/hyperglass/issues/287)
- [@bronson-calif](https://github.com/bronson-calif): [#383](https://github.com/hyperglass-community/hyperglass/issues/383)
- [@BrunoBlanes](https://github.com/BrunoBlanes): [#316](https://github.com/hyperglass-community/hyperglass/issues/316)
- [@buraglio](https://github.com/buraglio): [#189](https://github.com/hyperglass-community/hyperglass/issues/189)
- [@CarlosSuporteISP](https://github.com/CarlosSuporteISP): [#341](https://github.com/hyperglass-community/hyperglass/issues/341)
- [@chacal1231](https://github.com/chacal1231): [#285](https://github.com/hyperglass-community/hyperglass/issues/285)
- [@Ciacho](https://github.com/Ciacho): [#174](https://github.com/hyperglass-community/hyperglass/issues/174), [#175](https://github.com/hyperglass-community/hyperglass/issues/175), [#176](https://github.com/hyperglass-community/hyperglass/issues/176)
- [@cogenyk](https://github.com/cogenyk): [#218](https://github.com/hyperglass-community/hyperglass/issues/218)
- [@dazza76](https://github.com/dazza76): [#338](https://github.com/hyperglass-community/hyperglass/issues/338)
- [@devilofhell87](https://github.com/devilofhell87): [#315](https://github.com/hyperglass-community/hyperglass/issues/315)
- [@dpskipper](https://github.com/dpskipper): [#155](https://github.com/hyperglass-community/hyperglass/issues/155)
- [@ethamitc](https://github.com/ethamitc): [#152](https://github.com/hyperglass-community/hyperglass/issues/152), [#245](https://github.com/hyperglass-community/hyperglass/issues/245)
- [@ggidofalvy-tc](https://github.com/ggidofalvy-tc): [#173](https://github.com/hyperglass-community/hyperglass/issues/173)
- [@gondimcodes](https://github.com/gondimcodes): [#283](https://github.com/hyperglass-community/hyperglass/issues/283)
- [@Gronkstar](https://github.com/Gronkstar): [#231](https://github.com/hyperglass-community/hyperglass/issues/231)
- [@guyaevans](https://github.com/guyaevans): [#158](https://github.com/hyperglass-community/hyperglass/issues/158)
- [@handymenny](https://github.com/handymenny): [#180](https://github.com/hyperglass-community/hyperglass/issues/180)
- [@henriklb](https://github.com/henriklb): [#228](https://github.com/hyperglass-community/hyperglass/issues/228), [#229](https://github.com/hyperglass-community/hyperglass/issues/229), [#286](https://github.com/hyperglass-community/hyperglass/issues/286)
- [@internetplumber](https://github.com/internetplumber): [#339](https://github.com/hyperglass-community/hyperglass/issues/339)
- [@jdhall75](https://github.com/jdhall75): [#326](https://github.com/hyperglass-community/hyperglass/issues/326), [#331](https://github.com/hyperglass-community/hyperglass/issues/331)
- [@jmoore2016](https://github.com/jmoore2016): [#230](https://github.com/hyperglass-community/hyperglass/issues/230)
- [@job](https://github.com/job): [#206](https://github.com/hyperglass-community/hyperglass/issues/206)
- [@jsenecal](https://github.com/jsenecal): [#356](https://github.com/hyperglass-community/hyperglass/issues/356)
- [@justiceserv](https://github.com/justiceserv): [#184](https://github.com/hyperglass-community/hyperglass/issues/184)
- [@k-akashi](https://github.com/k-akashi): [#220](https://github.com/hyperglass-community/hyperglass/issues/220)
- [@KincaidYang](https://github.com/KincaidYang): [#244](https://github.com/hyperglass-community/hyperglass/issues/244)
- [@Kleiton-Silva](https://github.com/Kleiton-Silva): [#233](https://github.com/hyperglass-community/hyperglass/issues/233), [#234](https://github.com/hyperglass-community/hyperglass/issues/234)
- [@kmisak](https://github.com/kmisak): [#204](https://github.com/hyperglass-community/hyperglass/issues/204), [#252](https://github.com/hyperglass-community/hyperglass/issues/252)
- [@ktoczyski](https://github.com/ktoczyski): [#348](https://github.com/hyperglass-community/hyperglass/issues/348)
- [@laxxie](https://github.com/laxxie): [#355](https://github.com/hyperglass-community/hyperglass/issues/355)
- [@M0NsTeRRR](https://github.com/M0NsTeRRR): [#254](https://github.com/hyperglass-community/hyperglass/issues/254), [#255](https://github.com/hyperglass-community/hyperglass/issues/255), [#258](https://github.com/hyperglass-community/hyperglass/issues/258), [#278](https://github.com/hyperglass-community/hyperglass/issues/278)
- [@manonfgoo](https://github.com/manonfgoo): [#328](https://github.com/hyperglass-community/hyperglass/issues/328)
- [@mariokamenjak](https://github.com/mariokamenjak): [#223](https://github.com/hyperglass-community/hyperglass/issues/223), [#224](https://github.com/hyperglass-community/hyperglass/issues/224)
- [@masterjanic](https://github.com/masterjanic): [#353](https://github.com/hyperglass-community/hyperglass/issues/353)
- [@matthewenger](https://github.com/matthewenger): [#305](https://github.com/hyperglass-community/hyperglass/issues/305)
- [@mattpenn20](https://github.com/mattpenn20): [#270](https://github.com/hyperglass-community/hyperglass/issues/270)
- [@michaelwingender](https://github.com/michaelwingender): [#166](https://github.com/hyperglass-community/hyperglass/issues/166), [#190](https://github.com/hyperglass-community/hyperglass/issues/190)
- [@micush](https://github.com/micush): [#320](https://github.com/hyperglass-community/hyperglass/issues/320)
- [@moguv587](https://github.com/moguv587): [#205](https://github.com/hyperglass-community/hyperglass/issues/205)
- [@Mr-Sheep](https://github.com/Mr-Sheep): [#207](https://github.com/hyperglass-community/hyperglass/issues/207)
- [@mracar07](https://github.com/mracar07): [#310](https://github.com/hyperglass-community/hyperglass/issues/310)
- [@netravnen](https://github.com/netravnen): [#193](https://github.com/hyperglass-community/hyperglass/issues/193)
- [@pcfriek1987](https://github.com/pcfriek1987): [#145](https://github.com/hyperglass-community/hyperglass/issues/145)
- [@pengembaratemporer](https://github.com/pengembaratemporer): [#336](https://github.com/hyperglass-community/hyperglass/issues/336), [#337](https://github.com/hyperglass-community/hyperglass/issues/337)
- [@pmawsonau](https://github.com/pmawsonau): [#153](https://github.com/hyperglass-community/hyperglass/issues/153)
- [@pva](https://github.com/pva): [#360](https://github.com/hyperglass-community/hyperglass/issues/360), [#362](https://github.com/hyperglass-community/hyperglass/issues/362)
- [@resparis](https://github.com/resparis): [#203](https://github.com/hyperglass-community/hyperglass/issues/203)
- [@richardtector](https://github.com/richardtector): [#312](https://github.com/hyperglass-community/hyperglass/issues/312), [#313](https://github.com/hyperglass-community/hyperglass/issues/313)
- [@sabujp1](https://github.com/sabujp1): [#236](https://github.com/hyperglass-community/hyperglass/issues/236)
- [@samuk10](https://github.com/samuk10): [#318](https://github.com/hyperglass-community/hyperglass/issues/318)
- [@ServerForge](https://github.com/ServerForge): [#212](https://github.com/hyperglass-community/hyperglass/issues/212)
- [@shor0814](https://github.com/shor0814): [#317](https://github.com/hyperglass-community/hyperglass/issues/317)
- [@sipvoip](https://github.com/sipvoip): [#196](https://github.com/hyperglass-community/hyperglass/issues/196)
- [@Skylighty](https://github.com/Skylighty): [#215](https://github.com/hyperglass-community/hyperglass/issues/215)
- [@starcraft66](https://github.com/starcraft66): [#188](https://github.com/hyperglass-community/hyperglass/issues/188)
- [@SwimGeek](https://github.com/SwimGeek): [#311](https://github.com/hyperglass-community/hyperglass/issues/311)
- [@symysak](https://github.com/symysak): [#282](https://github.com/hyperglass-community/hyperglass/issues/282)
- [@syntax-terr0r](https://github.com/syntax-terr0r): [#142](https://github.com/hyperglass-community/hyperglass/issues/142)
- [@thatmattlove](https://github.com/thatmattlove): [#110](https://github.com/hyperglass-community/hyperglass/issues/110), [#143](https://github.com/hyperglass-community/hyperglass/issues/143)
- [@theaustinayers](https://github.com/theaustinayers): [#235](https://github.com/hyperglass-community/hyperglass/issues/235)
- [@timrabl](https://github.com/timrabl): [#209](https://github.com/hyperglass-community/hyperglass/issues/209)
- [@zpc-ar](https://github.com/zpc-ar): [#333](https://github.com/hyperglass-community/hyperglass/issues/333)

One Ultraglass report also shaped 3.0.0: [@allanfrizzo](https://github.com/allanfrizzo) requested a configurable trusted client-IP header in [Ultraglass #241](https://github.com/WilhelmZA/ultraglass/issues/241), which became `web.client_ip` in [#399](https://github.com/hyperglass-community/hyperglass/pull/399).

### Reviewers

- [@jdhall75](https://github.com/jdhall75) reviewed the pull requests listed under project lineage.
- [@jsenecal](https://github.com/jsenecal) reviewed [#407](https://github.com/hyperglass-community/hyperglass/pull/407) and [#409](https://github.com/hyperglass-community/hyperglass/pull/409).
- [@hcaldicott](https://github.com/hcaldicott) reviewed [#343](https://github.com/hyperglass-community/hyperglass/pull/343).

### Reference material for test fixtures

- The Fortinet multipath fixture is transcribed from [Yuri Slobodyanyuk's FortiGate BGP cookbook](https://yurisk.info/2020/05/20/fortigate-bgp-cookbook-of-example-configuration-and-debug/). See `hyperglass/plugins/tests/fixtures/firewall-reference/README.md`.
- The AOS-CX fixtures are transcribed from a third-party mirror of the HPE Aruba Networking CLI guide. See `hyperglass/plugins/tests/fixtures/aoscx-mirrored/README.md`.
